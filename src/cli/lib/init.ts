import chalk from "chalk";
import {
  pullConfig,
  writeProjectConfig,
  configFilepath,
  readProjectConfig,
  removedExistingConfig,
} from "./config.js";
import {
  logAndHandleAxiosError,
  functionsDir,
  validateOrSelectTeam,
  bigBrainAPI,
  loadPackageJson,
} from "./utils.js";
import inquirer from "inquirer";
import path from "path";
import { doCodegen, doInitCodegen } from "./codegen";
import {
  Context,
  logFailure,
  logFinishedStep,
  showSpinner,
} from "./context.js";
import { dashboardUrlForConfig } from "../dashboard.js";
import {
  askAboutWritingToEnv,
  logProvisioning,
  writeToEnv,
} from "./envvars.js";

const cwd = path.basename(process.cwd());

export async function init(
  ctx: Context,
  config: {
    team: string | null;
    project: string | null;
  },
  saveUrl: "yes" | "no" | "ask" = "ask",
  promptForAdditionalSteps?: () => Promise<() => Promise<void>>,
  options: { allowExistingConfig?: boolean } = { allowExistingConfig: false }
) {
  const configPath = await configFilepath(ctx);
  if (ctx.fs.exists(configPath)) {
    if (!removedExistingConfig(ctx, configPath, options)) {
      console.error(
        chalk.green(`Found existing project config "${configPath}"`)
      );
      return;
    }
  }

  const { teamSlug: selectedTeam, chosen: didChooseBetweenTeams } =
    await validateOrSelectTeam(ctx, config.team, "Team:");

  let projectName: string = config.project || cwd;
  if (process.stdin.isTTY && !config.project) {
    projectName = (
      await inquirer.prompt([
        {
          type: "input",
          name: "project",
          message: "Project name:",
          default: cwd,
        },
      ])
    ).project;
  }

  const prodEnvVarWrite = await askAboutWritingToEnv(
    ctx,
    "prod",
    null,
    saveUrl
  );

  const executeAdditionalSteps = await promptForAdditionalSteps?.();

  showSpinner(ctx, "Creating new Convex project...");

  let projectSlug,
    teamSlug,
    prodUrl,
    adminKey,
    projectsRemaining,
    projectConfig,
    modules;
  try {
    ({ projectSlug, teamSlug, prodUrl, adminKey, projectsRemaining } =
      await create_project(ctx, selectedTeam, projectName));

    ({ projectConfig, modules } = await pullConfig(
      ctx,
      projectSlug,
      teamSlug,
      prodUrl,
      adminKey
    ));
  } catch (err) {
    logFailure(ctx, "Unable to create project.");
    return await logAndHandleAxiosError(ctx, err);
  }

  const teamMessage = didChooseBetweenTeams
    ? " in team " + chalk.bold(teamSlug)
    : "";
  logFinishedStep(
    ctx,
    `Created project ${chalk.bold(
      projectSlug
    )}${teamMessage}, manage it at ${chalk.bold(
      await dashboardUrlForConfig(projectConfig, false)
    )}`
  );

  if (projectsRemaining <= 2) {
    console.log(
      chalk.yellow.bold(
        `Your account now has ${projectsRemaining} project${
          projectsRemaining === 1 ? "" : "s"
        } remaining.`
      )
    );
  }

  if (modules.length > 0) {
    console.error(chalk.red("Error: Unexpected modules in new project"));
    return await ctx.crash(1, undefined);
  }

  // create-react-app bans imports from outside of src, so we can just
  // put the functions directory inside of src/ to work around this issue.
  const packages = await loadPackageJson(ctx);
  const isCreateReactApp = "react-scripts" in packages;
  if (isCreateReactApp) {
    projectConfig.functions = `src/${projectConfig.functions}`;
  }

  await writeProjectConfig(ctx, projectConfig);
  await doInitCodegen(
    ctx,
    functionsDir(configPath, projectConfig),
    true // quiet
  );

  {
    const { projectConfig, configPath } = await readProjectConfig(ctx);
    await doCodegen({
      ctx,
      projectConfig,
      configPath,
      // Don't typecheck because there isn't any code to check yet.
      typeCheckMode: "disable",
      quiet: true,
    });
  }

  logFinishedStep(ctx, `Convex configuration written to ${configPath}`);
  await writeToEnv(ctx, prodEnvVarWrite, projectConfig.prodUrl);
  logProvisioning(ctx, prodEnvVarWrite, "prod", projectConfig.prodUrl);
  await executeAdditionalSteps?.();

  console.log(
    `\nWrite your Convex functions in ${chalk.bold(
      functionsDir(configPath, projectConfig)
    )}`
  );
  console.log(
    "Give us feedback at https://convex.dev/community or support@convex.dev\n"
  );
}

interface CreateProjectArgs {
  projectName: string;
  team: string;
  backendVersionOverride?: string;
}

/** Provision a new empty project and return the origin. */
async function create_project(
  ctx: Context,
  team: string,
  projectName: string
): Promise<{
  projectSlug: string;
  teamSlug: string;
  prodUrl: string;
  adminKey: string;
  projectsRemaining: number;
}> {
  const provisioningArgs: CreateProjectArgs = {
    team,
    backendVersionOverride: process.env.CONVEX_BACKEND_VERSION_OVERRIDE,
    projectName,
  };
  const data = await bigBrainAPI(
    ctx,
    "POST",
    "create_project",
    provisioningArgs
  );

  const projectSlug = data.projectSlug;
  const teamSlug = data.teamSlug;
  const prodUrl = data.prodUrl;
  const adminKey = data.adminKey;
  const projectsRemaining = data.projectsRemaining;
  if (
    projectSlug === undefined ||
    teamSlug === undefined ||
    prodUrl === undefined ||
    adminKey === undefined ||
    projectsRemaining === undefined
  ) {
    throw new Error(
      "Unknown error during provisioning: " + JSON.stringify(data)
    );
  }
  return { projectSlug, teamSlug, prodUrl, adminKey, projectsRemaining };
}
