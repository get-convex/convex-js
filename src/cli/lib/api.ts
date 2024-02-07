import chalk from "chalk";
import {
  CONVEX_DEPLOY_KEY_ENV_VAR_NAME,
  bigBrainAPI,
  bigBrainAPIMaybeThrows,
  getAuthHeaderFromGlobalConfig,
  getConfiguredDeploymentOrCrash,
  logAndHandleAxiosError,
  readAdminKeyFromEnvVar,
} from "./utils.js";
import { Context, logError, logFailure } from "../../bundler/context.js";
import {
  deploymentNameFromAdminKeyOrCrash,
  deploymentTypeFromAdminKey,
  readDeploymentEnvVar,
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
  const resultDeploymentType = data.deploymentType;
  if (adminKey === undefined || url === undefined) {
    const msg = "Unknown error during authorization: " + JSON.stringify(data);
    logError(ctx, chalk.red(msg));
    return await ctx.crash(1, "transient", new Error(msg));
  }
  return {
    deploymentName,
    adminKey,
    url,
    deploymentType: resultDeploymentType,
  };
}

export type DeploymentSelection =
  | { kind: "prod" }
  | { kind: "preview"; previewName: string }
  | { kind: "deployment"; deploymentName: string }
  | { kind: "ownDev" }
  | { kind: "urlWithAdminKey"; url: string; adminKey: string }
  | { kind: "urlWithLogin"; url: string };

export function storeAdminKeyEnvVar(adminKeyOption?: string | null) {
  if (adminKeyOption) {
    // So we don't have to worry about passing through the admin key everywhere
    // if it's explicitly overridden by a CLI option, override the env variable
    // directly.
    process.env[CONVEX_DEPLOY_KEY_ENV_VAR_NAME] = adminKeyOption;
  }
}

export type DeploymentSelectionOptions = {
  prod?: boolean | undefined;
  previewName?: string | undefined;
  deploymentName?: string | undefined;
  url?: string | undefined;
  adminKey?: string | undefined;
};

export function deploymentSelectionFromOptions(
  options: DeploymentSelectionOptions
): DeploymentSelection {
  storeAdminKeyEnvVar(options.adminKey);
  if (options.url !== undefined) {
    const adminKey = readAdminKeyFromEnvVar();
    if (adminKey) {
      return { kind: "urlWithAdminKey", url: options.url, adminKey };
    }
    return { kind: "urlWithLogin", url: options.url };
  }
  if (options.prod) {
    return { kind: "prod" };
  }
  if (options.previewName !== undefined) {
    return { kind: "preview", previewName: options.previewName };
  }
  if (options.deploymentName !== undefined) {
    return { kind: "deployment", deploymentName: options.deploymentName };
  }
  return { kind: "ownDev" };
}

// Deploy
export async function fetchDeploymentCredentialsWithinCurrentProject(
  ctx: Context,
  deploymentSelection: DeploymentSelection
): Promise<{
  url: string;
  adminKey: AdminKey;
  deploymentNames?: {
    configured: string | null;
    selected: string;
  };
  deploymentType?: string | undefined;
}> {
  if (deploymentSelection.kind === "urlWithAdminKey") {
    return {
      adminKey: deploymentSelection.adminKey,
      url: deploymentSelection.url,
    };
  }

  const configuredAdminKey = readAdminKeyFromEnvVar();

  const configuredDeployment = readDeploymentEnvVar();

  // Crash if we know that DEPLOY_KEY (adminKey) is required
  if (configuredAdminKey === undefined) {
    const buildEnvironmentExpectsConvexDeployKey = buildEnvironment();
    if (buildEnvironmentExpectsConvexDeployKey) {
      logFailure(
        ctx,
        `${buildEnvironmentExpectsConvexDeployKey} build environment detected but ${CONVEX_DEPLOY_KEY_ENV_VAR_NAME} is not set. ` +
          `Set this environment variable to deploy from this environment. See https://docs.convex.dev/production/hosting`
      );
      await ctx.crash(1);
    }
    const header = await getAuthHeaderFromGlobalConfig(ctx);
    if (!header) {
      logFailure(
        ctx,
        `Error: You are not logged in. Log in with \`npx convex dev\` or set the ${CONVEX_DEPLOY_KEY_ENV_VAR_NAME} environment variable. ` +
          `See https://docs.convex.dev/production/hosting`
      );
      await ctx.crash(1);
    }
  }

  const data = await fetchDeploymentCredentialsWithinCurrentProjectInner(
    ctx,
    deploymentSelection,
    configuredDeployment,
    configuredAdminKey
  );
  const {
    deploymentName: selectedDeploymentName,
    adminKey,
    deploymentType,
    url,
  } = data;
  if (
    adminKey === undefined ||
    url === undefined ||
    selectedDeploymentName === undefined
  ) {
    const msg = "Unknown error during authorization: " + JSON.stringify(data);
    logError(ctx, chalk.red(msg));
    return await ctx.crash(1, "transient", new Error(msg));
  }
  return {
    deploymentNames: {
      selected: selectedDeploymentName,
      configured: configuredDeployment,
    },
    adminKey,
    url,
    deploymentType,
  };
}

type ProjectSelection =
  | {
      kind: "deploymentName";
      // Identify a project by one of the deployments in it.
      deploymentName: string;
    }
  | {
      kind: "teamAndProjectSlugs";
      // Identify a project by its team and slug.
      teamSlug: string;
      projectSlug: string;
    };

export async function projectSelection(
  ctx: Context,
  configuredDeployment: string | null,
  configuredAdminKey: string | undefined
): Promise<ProjectSelection> {
  if (
    configuredAdminKey &&
    deploymentTypeFromAdminKey(configuredAdminKey) === "preview"
  ) {
    const adminKeyParts = configuredAdminKey.split("|")[0].split(":");
    if (adminKeyParts.length !== 3) {
      logFailure(ctx, "Invalid CONVEX_DEPLOY_KEY for previews");
      return await ctx.crash(1);
    }
    const [_preview, teamSlug, projectSlug] = adminKeyParts;
    return {
      kind: "teamAndProjectSlugs",
      teamSlug,
      projectSlug,
    };
  }
  if (
    configuredAdminKey &&
    deploymentTypeFromAdminKey(configuredAdminKey) === "prod"
  ) {
    return {
      kind: "deploymentName",
      deploymentName: await deploymentNameFromAdminKeyOrCrash(
        ctx,
        configuredAdminKey
      ),
    };
  }
  if (configuredDeployment) {
    return {
      kind: "deploymentName",
      deploymentName: configuredDeployment,
    };
  }
  logFailure(
    ctx,
    "Select project by setting `CONVEX_DEPLOYMENT` with `npx convex dev` or `CONVEX_DEPLOY_KEY` from the Convex dashboard."
  );
  return await ctx.crash(1);
}

async function fetchDeploymentCredentialsWithinCurrentProjectInner(
  ctx: Context,
  deploymentSelection: DeploymentSelection,
  configuredDeployment: string | null,
  configuredAdminKey: string | undefined
): Promise<{
  deploymentName?: string;
  adminKey?: string;
  url?: string;
  deploymentType?: string;
}> {
  switch (deploymentSelection.kind) {
    case "ownDev": {
      if (configuredDeployment === null) {
        logFailure(
          ctx,
          "No CONVEX_DEPLOYMENT set, run `npx convex dev` to configure a Convex project"
        );
        return await ctx.crash(1);
      }
      return {
        ...(await fetchExistingDevDeploymentCredentialsOrCrash(
          ctx,
          configuredDeployment
        )),
        deploymentName: configuredDeployment,
      };
    }
    case "prod":
      if (configuredDeployment === null) {
        logFailure(
          ctx,
          "No CONVEX_DEPLOYMENT set, run `npx convex dev` to configure a Convex project"
        );
        return await ctx.crash(1);
      }
      if (configuredAdminKey) {
        // Derive as much as we can from the configured admin key,
        // to avoid unnecessary API calls.
        const deploymentType = deploymentTypeFromAdminKey(configuredAdminKey);
        if (deploymentType !== "prod") {
          logFailure(
            ctx,
            `Please set ${CONVEX_DEPLOY_KEY_ENV_VAR_NAME} to a new key which you can find on the Convex dashboard for your production deployment.`
          );
          await ctx.crash(1);
        }
        let url;
        if (process.env.CONVEX_PROVISION_HOST) {
          const data = await bigBrainAPI({
            ctx,
            method: "POST",
            url: "deployment/authorize_prod",
            data: {
              deploymentName: configuredDeployment,
            },
          });
          url = data.url;
        } else {
          // When using prod big-brain, we can derive the backend url directly
          // from the deployment name.
          url = await deriveUrlFromAdminKey(ctx, configuredAdminKey);
        }
        return {
          adminKey: configuredAdminKey,
          url,
          deploymentName: configuredDeployment,
          deploymentType,
        };
      }
      return await bigBrainAPI({
        ctx,
        method: "POST",
        url: "deployment/authorize_prod",
        data: {
          deploymentName: configuredDeployment,
        },
      });
    case "preview":
      return await bigBrainAPI({
        ctx,
        method: "POST",
        url: "deployment/authorize_preview",
        data: {
          previewName: deploymentSelection.previewName,
          projectSelection: await projectSelection(
            ctx,
            configuredDeployment,
            configuredAdminKey
          ),
        },
      });
    case "deployment":
      return await bigBrainAPI({
        ctx,
        method: "POST",
        url: "deployment/authorize_within_current_project",
        data: {
          selectedDeploymentName: deploymentSelection.deploymentName,
          projectSelection: await projectSelection(
            ctx,
            configuredDeployment,
            configuredAdminKey
          ),
        },
      });
    case "urlWithLogin":
      return {
        ...(await bigBrainAPI({
          ctx,
          method: "POST",
          url: "deployment/authorize_within_current_project",
          data: {
            selectedDeploymentName: configuredDeployment,
            projectSelection: await projectSelection(
              ctx,
              configuredDeployment,
              configuredAdminKey
            ),
          },
        })),
        url: deploymentSelection.url,
      };
    case "urlWithAdminKey":
      return {
        adminKey: deploymentSelection.adminKey,
        url: deploymentSelection.url,
      };
    default: {
      const _exhaustivenessCheck: never = deploymentSelection;
      return ctx.crash(1);
    }
  }
}

// Run, Import
export async function fetchDeploymentCredentialsProvisionProd(
  ctx: Context,
  deploymentSelection: DeploymentSelection
): Promise<{
  url: string;
  adminKey: AdminKey;
  deploymentName?: string;
  deploymentType?: string;
}> {
  if (
    deploymentSelection.kind === "ownDev" &&
    !(await checkAuthorization(ctx, false))
  ) {
    await performLogin(ctx);
  }

  if (deploymentSelection.kind !== "ownDev") {
    const result = await fetchDeploymentCredentialsWithinCurrentProject(
      ctx,
      deploymentSelection
    );
    return {
      url: result.url,
      adminKey: result.adminKey,
      deploymentName: result.deploymentNames?.selected,
      deploymentType: result.deploymentType,
    };
  }

  const configuredDeployment = await getConfiguredDeploymentOrCrash(ctx);
  const result = await fetchExistingDevDeploymentCredentialsOrCrash(
    ctx,
    configuredDeployment
  );
  return {
    url: result.url,
    adminKey: result.adminKey,
    deploymentType: result.deploymentType,
    deploymentName: configuredDeployment,
  };
}

// Dashboard
export async function fetchTeamAndProject(
  ctx: Context,
  deploymentName: string
) {
  const data = (await bigBrainAPI({
    ctx,
    method: "GET",
    url: `deployment/${deploymentName}/team_and_project`,
  })) as {
    team: string; // slug
    project: string; // slug
    teamId: number;
    projectId: number;
  };

  const { team, project } = data;
  if (team === undefined || project === undefined) {
    const msg =
      "Unknown error when fetching team and project: " + JSON.stringify(data);
    logFailure(ctx, msg);
    return await ctx.crash(1, "transient", new Error(msg));
  }

  return data;
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

async function fetchExistingDevDeploymentCredentialsOrCrash(
  ctx: Context,
  deploymentName: DeploymentName
): Promise<{
  url: string;
  adminKey: AdminKey;
  deploymentType: "dev";
}> {
  const credentials = await fetchDeploymentCredentialsForName(
    ctx,
    deploymentName,
    "dev"
  );
  if ("error" in credentials) {
    logFailure(
      ctx,
      `Failed to authorize "${deploymentName}" configured in CONVEX_DEPLOYMENT, run \`npx convex dev\` to configure a Convex project`
    );
    return await ctx.crash(1, "invalid filesystem data", credentials.error);
  }
  if (credentials.deploymentType !== "dev") {
    logFailure(ctx, `Deployment "${deploymentName}" is not a dev deployment`);
    return await ctx.crash(1, "invalid filesystem data", credentials.error);
  }
  return credentials;
}

// This returns the the url of the deployment from an admin key in the format
//      "tall-forest-1234|1a2b35123541"
//   or "prod:tall-forest-1234|1a2b35123541"
async function deriveUrlFromAdminKey(ctx: Context, adminKey: string) {
  const deploymentName = await deploymentNameFromAdminKeyOrCrash(ctx, adminKey);
  return `https://${deploymentName}.convex.cloud`;
}
