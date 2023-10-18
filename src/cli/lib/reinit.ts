import { Context, logFailure, showSpinner } from "../../bundler/context.js";
import {
  DeploymentType,
  fetchDeploymentCredentialsProvisioningDevOrProd,
} from "./api.js";
import { doCodegen } from "./codegen.js";
import {
  configName,
  mergeWithLocalConfig,
  pullConfig,
  readProjectConfig,
  upgradeOldAuthInfoToAuthConfig,
  writeProjectConfig,
} from "./config.js";
import { writeDeploymentEnvVar } from "./deployment.js";
import { finalizeConfiguration } from "./init.js";
import {
  functionsDir,
  validateOrSelectProject,
  validateOrSelectTeam,
} from "./utils.js";

export async function reinit(
  ctx: Context,
  deploymentType: DeploymentType = "prod",
  config: {
    team: string | null;
    project: string | null;
  }
) {
  const { teamSlug } = await validateOrSelectTeam(ctx, config.team, "Team:");

  const projectSlug = await validateOrSelectProject(
    ctx,
    config.project,
    teamSlug,
    "Configure project",
    "Project:"
  );
  if (!projectSlug) {
    logFailure(ctx, "Aborted");
    return;
  }

  showSpinner(ctx, `Reinitializing project ${projectSlug}...\n`);

  const { deploymentName, url, adminKey } =
    await fetchDeploymentCredentialsProvisioningDevOrProd(
      ctx,
      { teamSlug, projectSlug },
      deploymentType
    );
  const { projectConfig: projectConfigFromBackend } = await pullConfig(
    ctx,
    projectSlug,
    teamSlug,
    url,
    adminKey
  );
  // Merge remote config with local config
  const mergedProjectConfig = await mergeWithLocalConfig(
    ctx,
    projectConfigFromBackend
  );

  const { wroteToGitIgnore } = await writeDeploymentEnvVar(
    ctx,
    deploymentType,
    {
      team: teamSlug,
      project: projectSlug,
      deploymentName: deploymentName!,
    }
  );

  const functionsPath = functionsDir(configName(), projectConfigFromBackend);
  const projectConfigWithoutAuthInfo = await upgradeOldAuthInfoToAuthConfig(
    ctx,
    mergedProjectConfig,
    functionsPath
  );
  await writeProjectConfig(ctx, projectConfigWithoutAuthInfo, {
    deleteIfAllDefault: true,
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
    functionsDir(configPath, projectConfig),
    deploymentType,
    url,
    wroteToGitIgnore
  );

  return { deploymentName, url, adminKey };
}
