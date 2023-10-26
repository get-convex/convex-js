import chalk from "chalk";
import {
  bigBrainAPI,
  bigBrainAPIMaybeThrows,
  getAuthHeaderFromGlobalConfig,
  getConfiguredDeploymentOrCrash,
  logAndHandleAxiosError,
} from "./utils.js";
import { Context, logError, logFailure } from "../../bundler/context.js";
import {
  readDeploymentEnvVar,
  stripDeploymentTypePrefix,
} from "./deployment.js";
import { buildEnvironment } from "./envvars.js";
import { checkAuthorization, performLogin } from "./login.js";

export type DeploymentName = string;
export type DeploymentType = "dev" | "prod";

export type Project = {
  id: string;
  name: string;
  slug: string;
  isDemo: boolean;
};

export const CONVEX_DEPLOY_KEY_ENV_VAR_NAME = "CONVEX_DEPLOY_KEY";

type AdminKey = string;

// Init
// Provision a new empty project and return the new deployment credentials.
export async function createProjectProvisioningDevOrProd(
  ctx: Context,
  {
    teamSlug: selectedTeamSlug,
    projectName,
  }: { teamSlug: string; projectName: string },
  firstDeploymentType: DeploymentType
): Promise<{
  projectSlug: string;
  teamSlug: string;
  deploymentName: string;
  url: string;
  adminKey: AdminKey;
  projectsRemaining: number;
}> {
  const provisioningArgs = {
    team: selectedTeamSlug,
    projectName,
    deploymentType: firstDeploymentType,
    backendVersionOverride: process.env.CONVEX_BACKEND_VERSION_OVERRIDE,
  };
  const data = await bigBrainAPI({
    ctx,
    method: "POST",
    url: "create_project",
    data: provisioningArgs,
  });
  const {
    projectSlug,
    teamSlug,
    deploymentName,
    adminKey,
    projectsRemaining,
    prodUrl: url,
  } = data;
  if (
    projectSlug === undefined ||
    teamSlug === undefined ||
    deploymentName === undefined ||
    url === undefined ||
    adminKey === undefined ||
    projectsRemaining === undefined
  ) {
    const error =
      "Unexpected response during provisioning: " + JSON.stringify(data);
    logError(ctx, chalk.red(error));
    return await ctx.crash(1, "transient", error);
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

// Reinit
export async function fetchDeploymentCredentialsProvisioningDevOrProd(
  ctx: Context,
  { teamSlug, projectSlug }: { teamSlug: string; projectSlug: string },
  deploymentType: DeploymentType
): Promise<{
  deploymentName: string | undefined;
  url: string;
  adminKey: AdminKey;
}> {
  try {
    return fetchDeploymentCredentialsProvisioningDevOrProdMaybeThrows(
      ctx,
      { teamSlug, projectSlug },
      deploymentType
    );
  } catch (error) {
    return await logAndHandleAxiosError(ctx, error);
  }
}

// Dev
export async function fetchDeploymentCredentialsForName(
  ctx: Context,
  deploymentName: DeploymentName,
  deploymentType: DeploymentType
) {
  let data;
  try {
    data = await bigBrainAPIMaybeThrows({
      ctx,
      method: "POST",
      url: "deployment/authorize_for_name",
      data: {
        deploymentName,
        deploymentType,
      },
    });
  } catch (error) {
    return { error };
  }
  const adminKey = data.adminKey;
  const url = data.url;
  if (adminKey === undefined || url === undefined) {
    const msg = "Unknown error during authorization: " + JSON.stringify(data);
    logError(ctx, chalk.red(msg));
    return await ctx.crash(1, "transient", new Error(msg));
  }
  return { deploymentName, adminKey, url };
}

export function readConfiguredAdminKey(
  adminKey: string | undefined
): string | undefined {
  return adminKey ?? process.env[CONVEX_DEPLOY_KEY_ENV_VAR_NAME] ?? undefined;
}

// Deploy
export async function fetchProdDeploymentCredentials(
  ctx: Context,
  options: {
    url?: string | undefined;
    adminKey?: string | undefined;
  }
): Promise<{
  url: string;
  adminKey: AdminKey;
  deploymentNames?: {
    configured: string;
    prod: string;
  };
}> {
  const configuredAdminKey = readConfiguredAdminKey(options.adminKey);
  const configuredUrl =
    options.url ?? (await deriveUrlFromAdminKey(ctx, configuredAdminKey));

  const configuredDeployment = readDeploymentEnvVar();

  // Crash if we know that DEPLOY_KEY (adminKey) is required
  if (configuredAdminKey === undefined) {
    const buildEnvironmentExpectsConvexDeployKey = buildEnvironment();
    if (buildEnvironmentExpectsConvexDeployKey) {
      logFailure(
        ctx,
        `${buildEnvironmentExpectsConvexDeployKey} build environment detected but ${CONVEX_DEPLOY_KEY_ENV_VAR_NAME} is not set. Set this environment variable to deploy from this environment.`
      );
      await ctx.crash(1);
    }
    const header = await getAuthHeaderFromGlobalConfig(ctx);
    if (!header) {
      logFailure(
        ctx,
        `Error: You are not logged in. Log in with \`npx convex dev\` or set the ${CONVEX_DEPLOY_KEY_ENV_VAR_NAME} environment variable.`
      );
      await ctx.crash(1);
    }
  }

  if (configuredAdminKey !== undefined && configuredUrl !== undefined) {
    return { adminKey: configuredAdminKey, url: configuredUrl };
  }

  if (configuredDeployment === null) {
    logFailure(
      ctx,
      "No CONVEX_DEPLOYMENT set, run `npx convex dev` to configure a Convex project"
    );
    return await ctx.crash(1);
  }

  const data = await bigBrainAPI({
    ctx,
    method: "POST",
    url: "deployment/authorize_prod",
    data: {
      deploymentName: configuredDeployment,
    },
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
    logError(ctx, chalk.red(msg));
    return await ctx.crash(1, "transient", new Error(msg));
  }
  return {
    deploymentNames: {
      prod: prodDeploymentName,
      configured: configuredDeployment,
    },
    adminKey: configuredAdminKey ?? adminKey,
    url: configuredUrl ?? url,
  };
}

// Run, Import
export async function fetchDeploymentCredentialsProvisionProd(
  ctx: Context,
  options: {
    prod?: boolean;
    url?: string | undefined;
    adminKey?: string | undefined;
  }
): Promise<{
  url: string;
  adminKey: AdminKey;
  deploymentName?: string;
}> {
  const deploymentType = options.prod ? "prod" : "dev";
  if (deploymentType === "prod") {
    const result = await fetchProdDeploymentCredentials(ctx, options);
    return {
      url: result.url,
      adminKey: result.adminKey,
      deploymentName: result.deploymentNames?.prod,
    };
  }
  const { url, adminKey } = options;
  if (url !== undefined && adminKey !== undefined) {
    return { url, adminKey };
  }

  if (!(await checkAuthorization(ctx, false))) {
    await performLogin(ctx);
  }

  const configuredDeployment = await getConfiguredDeploymentOrCrash(ctx);
  const result = await fetchExistingDeploymentCredentialsOrCrash(
    ctx,
    configuredDeployment,
    deploymentType
  );
  return {
    url: result.url,
    adminKey: result.adminKey,
    deploymentName: configuredDeployment,
  };
}

// Dashboard
export async function fetchTeamAndProject(
  ctx: Context,
  deploymentName: string
): Promise<{ team: string; project: string }> {
  const data = await bigBrainAPI({
    ctx,
    method: "GET",
    url: `deployment/${deploymentName}/team_and_project`,
  });
  const { team, project } = data;
  if (team === undefined || project === undefined) {
    const msg =
      "Unknown error when fetching team and project: " + JSON.stringify(data);
    logFailure(ctx, msg);
    return await ctx.crash(1, "transient", new Error(msg));
  }
  return { team, project };
}

// Used by dev for upgrade from team and project in convex.json to CONVEX_DEPLOYMENT
export async function fetchDeploymentCredentialsProvisioningDevOrProdMaybeThrows(
  ctx: Context,
  { teamSlug, projectSlug }: { teamSlug: string; projectSlug: string },
  deploymentType: DeploymentType
): Promise<{
  deploymentName: string | undefined;
  url: string;
  adminKey: AdminKey;
}> {
  const data = await await bigBrainAPIMaybeThrows({
    ctx,
    method: "POST",
    url: "deployment/provision_and_authorize",
    data: {
      teamSlug,
      projectSlug,
      deploymentType,
    },
  });
  const deploymentName = data.deploymentName;
  const adminKey = data.adminKey;
  const url = data.url;
  if (adminKey === undefined || url === undefined) {
    const msg = "Unknown error during authorization: " + JSON.stringify(data);
    logError(ctx, chalk.red(msg));
    return await ctx.crash(1, "transient", new Error(msg));
  }
  return { adminKey, url, deploymentName };
}

async function fetchExistingDeploymentCredentialsOrCrash(
  ctx: Context,
  deploymentName: DeploymentName,
  deploymentType: DeploymentType
): Promise<{
  url: string;
  adminKey: AdminKey;
}> {
  const credentials = await fetchDeploymentCredentialsForName(
    ctx,
    deploymentName,
    deploymentType
  );
  if ("error" in credentials) {
    logFailure(
      ctx,
      `Failed to authorize "${deploymentName}" configured in CONVEX_DEPLOYMENT, run \`npx convex dev\` to configure a Convex project`
    );
    return await ctx.crash(1, "invalid filesystem data", credentials.error);
  }
  return credentials;
}

// This returns the the url of the deployment from an admin key in the format
//      "tall-forest-1234|1a2b35123541"
//   or "prod:tall-forest-1234|1a2b35123541"
async function deriveUrlFromAdminKey(
  ctx: Context,
  adminKey: string | undefined
) {
  if (!adminKey) {
    return undefined;
  }
  const deploymentName = await deploymentNameFromAdminKey(ctx, adminKey);
  return `https://${deploymentName}.convex.cloud`;
}

export const deploymentNameFromAdminKey = async (
  ctx: Context,
  adminKey: string
) => {
  const parts = adminKey.split("|");
  if (parts.length === 1) {
    logFailure(
      ctx,
      `Please set ${CONVEX_DEPLOY_KEY_ENV_VAR_NAME} to a new key which you can find on your Convex dashboard.`
    );
    await ctx.crash(1);
  }
  return stripDeploymentTypePrefix(parts[0]);
};
