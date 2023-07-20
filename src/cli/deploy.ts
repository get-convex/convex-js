import chalk from "chalk";
import { Command, Option } from "commander";
import inquirer from "inquirer";
import {
  Context,
  logFinishedStep,
  logMessage,
  oneoffContext,
  showSpinner,
} from "../bundler/context";
import { fetchProdDeploymentCredentials } from "./lib/api";
import { suggestedEnvVarName } from "./lib/envvars";
import { PushOptions, runPush } from "./lib/push";

export const deploy = new Command("deploy")
  .description("Deploy to a production deployment")
  .option("-v, --verbose", "Show full listing of changes")
  .option(
    "--dry-run",
    "Print out the generated configuration without deploying to your production deployment"
  )
  .option("-y, --yes", "Skip confirmation prompt when running locally")
  .addOption(
    new Option(
      "--typecheck <mode>",
      `Whether to check TypeScript files with \`tsc --noEmit\` before deploying.`
    )
      .choices(["enable", "try", "disable"])
      .default("try")
  )
  .addOption(
    new Option(
      "--codegen <mode>",
      "Whether to regenerate code in `convex/_generated/` before pushing."
    )
      .choices(["enable", "disable"])
      .default("enable")
  )
  .addOption(new Option("--debug-bundle-path <path>").hideHelp())
  .addOption(new Option("--debug").hideHelp())
  // Hidden options to pass in admin key and url for tests and local development
  .addOption(new Option("--admin-key <adminKey>").hideHelp())
  .addOption(new Option("--url <url>").hideHelp())
  .showHelpAfterError()
  .action(async cmdOptions => {
    const ctx = oneoffContext;

    const { adminKey, url, deploymentNames } =
      await fetchProdDeploymentCredentials(ctx, cmdOptions);

    if (deploymentNames !== undefined) {
      const shouldPushToProd =
        deploymentNames.prod === deploymentNames.configured ||
        (cmdOptions.yes ?? (await askToConfirmPush(ctx, deploymentNames, url)));
      if (!shouldPushToProd) {
        await ctx.crash(1);
      }
    }

    const options: PushOptions = {
      adminKey,
      verbose: !!cmdOptions.verbose,
      dryRun: !!cmdOptions.dryRun,
      typecheck: cmdOptions.typecheck,
      debug: !!cmdOptions.debug,
      debugBundlePath: cmdOptions.debugBundlePath,
      codegen: cmdOptions.codegen === "enable",
      url,
    };
    showSpinner(
      ctx,
      `Deploying to ${url}...${options.dryRun ? " [dry run]" : ""}`
    );
    await runPush(oneoffContext, options);
    logFinishedStep(
      ctx,
      `${
        options.dryRun ? "Would have deployed" : "Deployed"
      } Convex functions to ${url}`
    );
  });

async function askToConfirmPush(
  ctx: Context,
  deploymentNames: {
    configured: string;
    prod: string;
  },
  prodUrl: string
) {
  logMessage(
    ctx,
    `\
You're currently developing against your ${chalk.bold("dev")} deployment

  ${deploymentNames.configured} (set in CONVEX_DEPLOYMENT)

Your ${chalk.bold("prod")} deployment ${chalk.bold(
      deploymentNames.prod
    )} serves traffic at:

  ${(await suggestedEnvVarName(ctx)).envVar}=${chalk.bold(prodUrl)}

Make sure that your published client is configured with this URL (for instructions see https://docs.convex.dev/hosting)\n`
  );
  return (
    await inquirer.prompt([
      {
        type: "confirm",
        name: "shouldPush",
        message: `Do you want to push your code to your prod deployment ${deploymentNames.prod} now?`,
        default: true,
      },
    ])
  ).shouldPush;
}
