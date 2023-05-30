import chalk from "chalk";
import {
  bigBrainAPI,
  bigBrainAPIMaybeThrows,
  getConfiguredDeploymentOrCrashIfNoConfig,
} from "./utils.js";
import { Context, logFailure } from "../../bundler/context.js";
import { enforceDeprecatedConfigField, readProjectConfig } from "./config.js";

export type deploymentName = string;
export type DeploymentType = "dev" | "prod";

export type Project = {
  id: string;
  name: string;
  slug: string;
  active_instances: number;
};

type AdminKey = string;
interface AuthorizeArgs {
  projectSlug: string;
  teamSlug: string;
  deploymentType: DeploymentType;
}

export async function getProdUrlAndAdminKey(
  ctx: Context,
  deploymentName: string
): Promise<{
  deploymentName: string;
  url: string;
  adminKey: AdminKey;
}> {
  const data = await bigBrainAPI(ctx, "POST", "deployment/authorize_prod", {
    deploymentName,
  });
  const prodDeploymentName = data.deploymentName;
  const adminKey = data.adminKey;
  const url = data.url;
  if (
    adminKey === undefined ||
    url === undefined ||
    prodDeploymentName === undefined
  ) {
    const msg = "Unknown error during authorization: " + JSON.stringify(data);
    console.error(chalk.red(msg));
    return await ctx.crash(1, "transient", new Error(msg));
  }
  return { deploymentName: prodDeploymentName, adminKey, url };
}

// This includes fallback to team+project from convex.json
// for legacy setups. Similar to `deploy` it provisions
// a prod deployment on demand in new flow.
export async function getUrlAndAdminKeyForConfiguredDeployment(
  ctx: Context,
  options: {
    prod?: boolean;
    url?: string | undefined;
    adminKey?: string | undefined;
  }
): Promise<{
  url: string;
  adminKey: AdminKey;
}> {
  const { url, adminKey, prod } = options;
  if (url !== undefined && adminKey !== undefined) {
    return { url, adminKey };
  }

  const deploymentType = prod ? "prod" : "dev";
  const configuredDeployment = await getConfiguredDeploymentOrCrashIfNoConfig(
    ctx
  );

  if (configuredDeployment !== null) {
    return deploymentType === "prod"
      ? await getProdUrlAndAdminKey(ctx, configuredDeployment)
      : await getUrlAndAdminKeyFromSlugOrCrash(
          ctx,
          configuredDeployment,
          deploymentType
        );
  }
  // Legacy config
  const { projectConfig } = await readProjectConfig(ctx);
  return await getUrlAndAdminKeyByDeploymentType(
    ctx,
    await enforceDeprecatedConfigField(ctx, projectConfig, "project"),
    await enforceDeprecatedConfigField(ctx, projectConfig, "team"),
    deploymentType
  );
}

export async function getUrlAndAdminKeyByDeploymentType(
  ctx: Context,
  projectSlug: string,
  teamSlug: string,
  deploymentType: DeploymentType
): Promise<{
  deploymentName: string | undefined;
  url: string;
  adminKey: AdminKey;
}> {
  const authorizeArgs: AuthorizeArgs = {
    projectSlug,
    teamSlug,
    deploymentType,
  };
  const data = await bigBrainAPI(
    ctx,
    "POST",
    "deployment/authorize",
    authorizeArgs
  );
  const deploymentName = data.deploymentName;
  const adminKey = data.adminKey;
  const url = data.url;
  if (adminKey === undefined || url === undefined) {
    const msg = "Unknown error during authorization: " + JSON.stringify(data);
    console.error(chalk.red(msg));
    return await ctx.crash(1, "transient", new Error(msg));
  }
  return { adminKey, url, deploymentName };
}

export async function getUrlAndAdminKeyFromSlugOrCrash(
  ctx: Context,
  deploymentName: deploymentName,
  deploymentType: DeploymentType
): Promise<{
  url: string;
  adminKey: AdminKey;
}> {
  const credentials = await getUrlAndAdminKeyFromSlug(
    ctx,
    deploymentName,
    deploymentType
  );
  if ("error" in credentials) {
    logFailure(ctx, `Failed to authorize deployment ${deploymentName}`);
    return await ctx.crash(1, "invalid filesystem data", credentials.error);
  }
  return credentials;
}

export async function getUrlAndAdminKeyFromSlug(
  ctx: Context,
  deploymentName: deploymentName,
  deploymentType: DeploymentType
): Promise<
  | {
      url: string;
      adminKey: AdminKey;
    }
  | { error: unknown }
> {
  let data;
  try {
    data = await bigBrainAPIMaybeThrows(
      ctx,
      "POST",
      "deployment/authorize_for_name",
      {
        deploymentName,
        deploymentType,
      }
    );
  } catch (error) {
    return { error };
  }
  const adminKey = data.adminKey;
  const url = data.url;
  if (adminKey === undefined || url === undefined) {
    const msg = "Unknown error during authorization: " + JSON.stringify(data);
    console.error(chalk.red(msg));
    return await ctx.crash(1, "transient", new Error(msg));
  }
  return { adminKey, url };
}

type DevDeployment = {
  deploymentName?: string;
  url: string;
  adminKey: string;
};

type DevDeploymentArgs = {
  projectSlug: string;
  teamSlug: string;
  backendVersionOverride?: string;
};
export async function getDevDeploymentMaybeThrows(
  ctx: Context,
  args: DevDeploymentArgs
): Promise<DevDeployment> {
  return await bigBrainAPIMaybeThrows(ctx, "PUT", "dev_deployment", args);
}

export async function fetchTeamAndProject(
  ctx: Context,
  deploymentName: string
): Promise<{ team: string; project: string }> {
  const data = await bigBrainAPI(
    ctx,
    "GET",
    `deployment/${deploymentName}/team_and_project`
  );
  const { team, project } = data;
  if (team === undefined || project === undefined) {
    const msg =
      "Unknown error when fetching team and project: " + JSON.stringify(data);
    logFailure(ctx, msg);
    return await ctx.crash(1, "transient", new Error(msg));
  }
  return { team, project };
}
