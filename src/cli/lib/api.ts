import chalk from "chalk";
import { bigBrainAPI, bigBrainAPIMaybeThrows } from "./utils.js";
import { Context } from "./context.js";

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

export async function getUrlAndAdminKey(
  ctx: Context,
  projectSlug: string,
  teamSlug: string,
  deploymentType: DeploymentType
): Promise<{
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
