import chalk from "chalk";
import inquirer from "inquirer";
import path from "path";
import {
  Context,
  logFailure,
  logFinishedStep,
  logMessage,
  showSpinner,
} from "../../bundler/context.js";
import { dashboardUrl } from "../dashboard.js";
import { deploymentCredentialsOrConfigure } from "../dev.js";
import { DeploymentType } from "./api.js";
import { doCodegen, doInitCodegen } from "./codegen";
import {
  configFilepath,
  getFunctionsDirectoryPath,
  pullConfig,
  upgradeOldAuthInfoToAuthConfig,
  writeProjectConfig,
} from "./config.js";
import { writeDeploymentEnvVar } from "./deployment.js";
import { askAboutWritingToEnv, writeToEnv } from "./envvars.js";
import {
  bigBrainAPI,
  functionsDir,
  loadPackageJson,
  logAndHandleAxiosError,
  validateOrSelectTeam,
} from "./utils.js";

const cwd = path.basename(process.cwd());

export async function init(
  ctx: Context,
  deploymentType: DeploymentType = "prod",
  config: {
    team: string | null;
    project: string | null;
  }
) {
  const configPath = await configFilepath(ctx);

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

  showSpinner(ctx, "Creating new Convex project...");

  let projectSlug,
    teamSlug,
    deploymentName,
    url,
    adminKey,
    projectsRemaining,
    projectConfig,
    modules;
  try {
    ({
      projectSlug,
      teamSlug,
      deploymentName,
      url,
      adminKey,
      projectsRemaining,
    } = await create_project(ctx, selectedTeam, projectName, deploymentType));

    ({ projectConfig, modules } = await pullConfig(
      ctx,
      projectSlug,
      teamSlug,
      url,
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
      dashboardUrl(teamSlug, projectSlug, null)
    )}`
  );

  if (projectsRemaining <= 2) {
    console.error(
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
  const functionsPath = functionsDir(configPath, projectConfig);

  const { wroteToGitIgnore } = await writeDeploymentEnvVar(
    ctx,
    deploymentType,
    {
      team: teamSlug,
      project: projectSlug,
      deploymentName,
    }
  );

  const projectConfigWithoutAuthInfo = await upgradeOldAuthInfoToAuthConfig(
    ctx,
    projectConfig,
    functionsPath
  );
  await writeProjectConfig(ctx, projectConfigWithoutAuthInfo);

  await doInitCodegen(
    ctx,
    functionsPath,
    true // quiet
  );

  {
    const functionsDirectoryPath = await getFunctionsDirectoryPath(ctx);
    await doCodegen({
      ctx,
      functionsDirectoryPath,
      // Don't typecheck because there isn't any code to check yet.
      typeCheckMode: "disable",
      quiet: true,
    });
  }

  await finalizeConfiguration(
    ctx,
    functionsPath,
    deploymentType,
    url,
    wroteToGitIgnore
  );

  return { deploymentName, adminKey, url };
}

// This works like running `dev --once` for the first time
// but without a push.
// It only exists for backwards compatibility with existing
// scripts that used `convex init` or `convex reinit`.
export async function initOrReinitForDeprecatedCommands(
  ctx: Context,
  cmdOptions: {
    team: string | null;
    project: string | null;
    url?: string | undefined;
    adminKey?: string | undefined;
  }
) {
  const { url } = await deploymentCredentialsOrConfigure(ctx, null, {
    ...cmdOptions,
    prod: false,
  });
  // Try the CONVEX_URL write again in case the user had an existing
  // convex.json but didn't have CONVEX_URL in .env.local.
  const envVarWrite = await askAboutWritingToEnv(ctx, "dev", url, "yes");
  await writeToEnv(ctx, envVarWrite, url);
  if (envVarWrite !== null) {
    logMessage(
      ctx,
      chalk.green(
        `Saved the dev deployment URL as ${envVarWrite.envVar} to ${envVarWrite.envFile}`
      )
    );
  }
}

export async function finalizeConfiguration(
  ctx: Context,
  functionsPath: string,
  deploymentType: DeploymentType,
  url: string,
  wroteToGitIgnore: boolean
) {
  const envVarWrite = await askAboutWritingToEnv(ctx, "dev", url, "yes");
  await writeToEnv(ctx, envVarWrite, url);
  if (envVarWrite !== null) {
    logFinishedStep(
      ctx,
      `Provisioned a ${deploymentType} deployment and saved its:\n` +
        `    name as CONVEX_DEPLOYMENT to .env.local\n` +
        `    URL as ${envVarWrite.envVar} to ${envVarWrite.envFile}`
    );
  } else {
    logFinishedStep(
      ctx,
      `Provisioned ${deploymentType} deployment and saved its name as CONVEX_DEPLOYMENT to .env.local`
    );
  }
  if (wroteToGitIgnore) {
    logMessage(ctx, chalk.gray(`  Added ".env.local" to .gitignore`));
  }

  console.error(
    `\nWrite your Convex functions in ${chalk.bold(functionsPath)}`
  );
  console.error(
    "Give us feedback at https://convex.dev/community or support@convex.dev\n"
  );
}

interface CreateProjectArgs {
  projectName: string;
  team: string;
  backendVersionOverride?: string;
  deploymentType?: "prod" | "dev";
}

/** Provision a new empty project and return the origin. */
async function create_project(
  ctx: Context,
  team: string,
  projectName: string,
  firstDeploymentType: "prod" | "dev"
): Promise<{
  projectSlug: string;
  teamSlug: string;
  deploymentName: string;
  url: string;
  adminKey: string;
  projectsRemaining: number;
}> {
  const provisioningArgs: CreateProjectArgs = {
    team,
    backendVersionOverride: process.env.CONVEX_BACKEND_VERSION_OVERRIDE,
    projectName,
    deploymentType: firstDeploymentType,
  };
  const data = await bigBrainAPI(
    ctx,
    "POST",
    "create_project",
    provisioningArgs
  );

  const projectSlug = data.projectSlug;
  const teamSlug = data.teamSlug;
  const deploymentName = data.deploymentName;
  const url = data.prodUrl;
  const adminKey = data.adminKey;
  const projectsRemaining = data.projectsRemaining;
  if (
    projectSlug === undefined ||
    teamSlug === undefined ||
    deploymentName === undefined ||
    url === undefined ||
    adminKey === undefined ||
    projectsRemaining === undefined
  ) {
    // Okay to throw here because this is an unexpected error.
    // eslint-disable-next-line no-restricted-syntax
    throw new Error(
      "Unknown error during provisioning: " + JSON.stringify(data)
    );
  }
  return {
    projectSlug,
    teamSlug,
    deploymentName,
    url,
    adminKey,
    projectsRemaining,
  };
}
