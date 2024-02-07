import chalk from "chalk";
import { logMessage, oneoffContext } from "../bundler/context.js";
import { watchLogs } from "./lib/logs.js";
import {
  deploymentSelectionFromOptions,
  fetchDeploymentCredentialsProvisionProd,
} from "./lib/api.js";
import { DeploymentCommand } from "./lib/utils.js";
import { InvalidArgumentError } from "commander";

export const logs = new DeploymentCommand("logs")
  .summary("Watch logs from your deployment")
  .description(
    "Stream function logs from your Convex deployment.\nBy default, this streams from your project's dev deployment."
  )
  .option(
    "--history [n]",
    "Show `n` most recent logs. Defaults to showing all available logs.",
    parseInteger
  )
  .addDeploymentSelectionOptions("Watch logs from")
  .showHelpAfterError()
  .action(async (cmdOptions) => {
    const ctx = oneoffContext;

    const deploymentSelection = deploymentSelectionFromOptions(cmdOptions);
    const credentials = await fetchDeploymentCredentialsProvisionProd(
      ctx,
      deploymentSelection
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
    await watchLogs(ctx, credentials.url, credentials.adminKey, "stdout", {
      history: cmdOptions.history,
    });
  });

function parseInteger(value: string) {
  const parsedValue = +value;
  if (isNaN(parsedValue)) {
    // eslint-disable-next-line no-restricted-syntax
    throw new InvalidArgumentError("Not a number.");
  }
  return parsedValue;
}
