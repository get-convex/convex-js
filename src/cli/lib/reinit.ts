import chalk from "chalk";
import { Context } from "../../bundler/context.js";
import { DeploymentType, getUrlAndAdminKeyByDeploymentType } from "./api.js";
import { doCodegen } from "./codegen.js";
import {
  configName,
  pullConfig,
  readProjectConfig,
  removedExistingConfig,
  upgradeOldAuthInfoToAuthConfig,
  writeProjectConfig,
} from "./config.js";
import { showSpinner } from "../../bundler/context.js";
import {
  functionsDir,
  shouldUseNewFlow,
  validateOrSelectProject,
  validateOrSelectTeam,
} from "./utils.js";
import { askAboutWritingToEnv } from "./envvars.js";
import { writeDeploymentEnvVar } from "./deployment.js";
import { finalizeConfiguration } from "./init.js";

export async function reinit(
  ctx: Context,
  deploymentType: DeploymentType = "prod",
  config: {
    team: string | null;
    project: string | null;
  },
  saveUrl: "yes" | "no" | "ask" = "ask",
  promptForAdditionalSteps?: () => Promise<() => Promise<void>>,
  options: {
    allowExistingConfig?: boolean;
  } = {}
) {
  const configFn = configName();
  if (!shouldUseNewFlow() && ctx.fs.exists(configFn)) {
    if (!removedExistingConfig(ctx, configFn, options)) {
      console.error(chalk.red(`File "${configFn}" already exists.`));
      console.error(
        "If you'd like to regenerate it, delete the file and rerun `npx convex reinit`"
      );
      return await ctx.crash(1, "invalid filesystem data");
    }
  }

  const { teamSlug } = await validateOrSelectTeam(ctx, config.team, "Team:");

  const projectSlug = await validateOrSelectProject(
    ctx,
    config.project,
    teamSlug,
    "Configure project",
    "Project:"
  );
  if (!projectSlug) {
    console.error("Aborted");
    return;
  }

  const prodEnvVarWrite = shouldUseNewFlow()
    ? null
    : await askAboutWritingToEnv(ctx, "prod", null, saveUrl);

  const executeAdditionalSteps = await promptForAdditionalSteps?.();

  showSpinner(ctx, `Reinitializing project ${projectSlug}...\n`);

  const { deploymentName, url, adminKey } =
    await getUrlAndAdminKeyByDeploymentType(
      ctx,
      projectSlug,
      teamSlug,
      deploymentType
    );
  const { projectConfig: projectConfigFromBackend } = await pullConfig(
    ctx,
    projectSlug,
    teamSlug,
    url,
    adminKey
  );
  const { wroteToGitIgnore } = shouldUseNewFlow()
    ? await writeDeploymentEnvVar(ctx, deploymentType, {
        team: teamSlug,
        project: projectSlug,
        deploymentName: deploymentName!,
      })
    : { wroteToGitIgnore: false };

  const functionsPath = functionsDir(configName(), projectConfigFromBackend);
  const projectConfigWithoutAuthInfo = shouldUseNewFlow()
    ? await upgradeOldAuthInfoToAuthConfig(
        ctx,
        projectConfigFromBackend,
        functionsPath
      )
    : projectConfigFromBackend;
  await writeProjectConfig(ctx, projectConfigWithoutAuthInfo, {
    deleteIfAllDefault: shouldUseNewFlow(),
  });

  const { projectConfig, configPath } = await readProjectConfig(ctx);
  await doCodegen({
    ctx,
    functionsDirectoryPath: functionsDir(configPath, projectConfig),
    typeCheckMode: "disable",
    quiet: true,
  });

  await finalizeConfiguration(
    ctx,
    configPath,
    functionsDir(configPath, projectConfig),
    deploymentType,
    prodEnvVarWrite,
    url,
    wroteToGitIgnore,
    executeAdditionalSteps
  );

  return { deploymentName, url, adminKey };
}
