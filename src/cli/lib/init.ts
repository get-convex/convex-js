import chalk from "chalk";
import inquirer from "inquirer";
import path from "path";
import {
  Context,
  logFailure,
  logFinishedStep,
  logMessage,
  logWarning,
  showSpinner,
} from "../../bundler/context.js";
import { dashboardUrl } from "../dashboard.js";
import { DeploymentType, createProjectProvisioningDevOrProd } from "./api.js";
import { doCodegen, doInitCodegen } from "./codegen.js";
import {
  configFilepath,
  getFunctionsDirectoryPath,
  pullConfig,
  upgradeOldAuthInfoToAuthConfig,
  writeProjectConfig,
} from "./config.js";
import { writeDeploymentEnvVar } from "./deployment.js";
import { writeConvexUrlToEnvFile } from "./envvars.js";
import {
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
    } = await createProjectProvisioningDevOrProd(
      ctx,
      { teamSlug: selectedTeam, projectName },
      deploymentType
    ));

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
    logWarning(
      ctx,
      chalk.yellow.bold(
        `Your account now has ${projectsRemaining} project${
          projectsRemaining === 1 ? "" : "s"
        } remaining.`
      )
    );
  }

  if (modules.length > 0) {
    logFailure(ctx, chalk.red("Error: Unexpected modules in new project"));
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

  await doInitCodegen({
    ctx,
    functionsDirectoryPath: functionsPath,
    quiet: true,
  });
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

export async function finalizeConfiguration(
  ctx: Context,
  functionsPath: string,
  deploymentType: DeploymentType,
  url: string,
  wroteToGitIgnore: boolean
) {
  const envVarWrite = await writeConvexUrlToEnvFile(ctx, url);
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

  logMessage(
    ctx,
    `\nWrite your Convex functions in ${chalk.bold(functionsPath)}\n` +
      "Give us feedback at https://convex.dev/community or support@convex.dev\n"
  );
}
