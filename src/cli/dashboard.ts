import { Command } from "commander";
import chalk from "chalk";
import { ProjectConfig, readProjectConfig } from "./lib/config.js";
import open from "open";
import { Context, oneoffContext } from "./lib/context.js";

export const dashboard = new Command("dashboard")
  .description("Open the dashboard in the browser")
  .option(
    "--no-open",
    "Don't automatically open the dashboard in the default browser"
  )
  .action(async options => {
    const ctx = oneoffContext;
    const loginUrl = await dashboardUrl(ctx);

    if (options.open) {
      console.log(chalk.gray(`Opening ${loginUrl} in the default browser...`));
      await open(loginUrl);
    } else {
      console.log(loginUrl);
    }
  });

export async function dashboardUrl(
  ctx: Context,
  includeDeployment = true
): Promise<string> {
  const { projectConfig } = await readProjectConfig(ctx);
  return dashboardUrlForConfig(projectConfig, includeDeployment);
}

export async function dashboardUrlForConfig(
  projectConfig: ProjectConfig,
  includeDeployment = true
): Promise<string> {
  const { project, team, prodUrl } = projectConfig;
  const host = process.env.CONVEX_PROVISION_HOST
    ? "http://localhost:3000"
    : "https://dashboard.convex.dev";

  // in local dev we don't know the deployment name
  if (process.env.CONVEX_PROVISION_HOST) {
    return host;
  }

  const deployment = prodUrl.match(/https?:\/\/([^.]*)[.]/)![1];
  return `${host}/t/${team}/${project}${
    includeDeployment ? `/${deployment}` : ""
  }`;
}
