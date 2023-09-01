import { Command } from "commander";
import chalk from "chalk";
import {
  ProjectConfig,
  enforceDeprecatedConfigField,
  readProjectConfig,
} from "./lib/config.js";
import open from "open";
import { Context, logMessage, oneoffContext } from "../bundler/context.js";
import { fetchTeamAndProject } from "./lib/api.js";
import { getConfiguredDeploymentOrCrash } from "./lib/utils.js";

export const dashboard = new Command("dashboard")
  .description("Open the dashboard in the browser")
  .option(
    "--no-open",
    "Don't automatically open the dashboard in the default browser"
  )
  .action(async (options) => {
    const ctx = oneoffContext;
    const configuredDeployment = await getConfiguredDeploymentOrCrash(ctx);
    const loginUrl = await dashboardUrlForConfiguredDeployment(
      ctx,
      configuredDeployment
    );

    if (options.open) {
      logMessage(
        ctx,
        chalk.gray(`Opening ${loginUrl} in the default browser...`)
      );
      await open(loginUrl);
    } else {
      console.log(loginUrl);
    }
  });

export async function dashboardUrlForConfiguredDeployment(
  ctx: Context,
  configuredDeployment: string | null
): Promise<string> {
  if (configuredDeployment !== null) {
    const { team, project } = await fetchTeamAndProject(
      ctx,
      configuredDeployment
    );
    return dashboardUrl(team, project, configuredDeployment);
  }
  const { projectConfig } = await readProjectConfig(ctx);
  return dashboardUrlForConfig(ctx, projectConfig);
}

async function dashboardUrlForConfig(
  ctx: Context,
  projectConfig: ProjectConfig
): Promise<string> {
  const team = await enforceDeprecatedConfigField(ctx, projectConfig, "team");
  const project = await enforceDeprecatedConfigField(
    ctx,
    projectConfig,
    "project"
  );
  const prodUrl = await enforceDeprecatedConfigField(
    ctx,
    projectConfig,
    "prodUrl"
  );
  const host = process.env.CONVEX_PROVISION_HOST
    ? "http://localhost:6789"
    : "https://dashboard.convex.dev";

  // in local dev we don't know the deployment name
  if (process.env.CONVEX_PROVISION_HOST) {
    return host;
  }

  const deployment = prodUrl.match(/https?:\/\/([^.]*)[.]/)![1];
  return dashboardUrl(team, project, deployment);
}

export function dashboardUrl(
  team: string,
  project: string,
  deploymentName: string | null
) {
  const host = process.env.CONVEX_PROVISION_HOST
    ? "http://localhost:6789"
    : "https://dashboard.convex.dev";
  return `${host}/t/${team}/${project}${
    deploymentName !== null ? `/${deploymentName}` : ""
  }`;
}
