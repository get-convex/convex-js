import chalk from "chalk";
import { Command, Option } from "commander";
import { logMessage, oneoffContext } from "../bundler/context.js";
import { watchLogs } from "./lib/logs.js";
import { fetchDeploymentCredentialsProvisionProd } from "./lib/api.js";

export const logs = new Command("logs")
  .summary("Watch for logs in this project's Convex deployment")
  .description(
    "Stream function logs from your Convex deployment.\nBy default, this streams from your project's dev deployment."
  )
  .option("--prod", "Watch logs in this project's production deployment.")
  .addOption(new Option("--admin-key <adminKey>").hideHelp())
  .addOption(new Option("--url <url>").hideHelp())
  .showHelpAfterError()
  .action(async (cmdOptions) => {
    const ctx = oneoffContext;

    const credentials = await fetchDeploymentCredentialsProvisionProd(
      ctx,
      cmdOptions
    );
    if (cmdOptions.prod) {
      logMessage(
        ctx,
        chalk.yellow(
          `Watching logs for production deployment ${
            credentials.deploymentName || ""
          }...`
        )
      );
    } else {
      logMessage(
        ctx,
        chalk.yellow(
          `Watching logs for dev deployment ${
            credentials.deploymentName || ""
          }...`
        )
      );
    }
    await watchLogs(ctx, credentials.url, credentials.adminKey, "stdout");
  });
