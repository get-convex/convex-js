import chalk from "chalk";
import { Command, Option } from "commander";
import { getUrlAndAdminKey } from "./lib/api";
import { readProjectConfig } from "./lib/config";
import { logFinishedStep, oneoffContext, showSpinner } from "./lib/context";
import { buildEnvironment, offerToWriteToEnv } from "./lib/envvars";
import { PushOptions, runPush } from "./lib/push";

export const deploy = new Command("deploy")
  .description("Deploy to a production deployment")
  .option("-v, --verbose", "Show full listing of changes")
  .option(
    "--dry-run",
    "Print out the generated configuration without deploying to your production deployment"
  )
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
  .option(
    "--save-url",
    "Save the production deployment URL to .env or .env.production."
  )
  .option(
    "--no-save-url",
    "Do not save production deployment URL to a .env file. (default)"
  )

  .addOption(new Option("--debug-bundle-path <path>").hideHelp())
  .addOption(new Option("--debug").hideHelp())
  // harmless deprecated option
  .addOption(new Option("-y, --yes").hideHelp())
  // Hidden options to pass in admin key and url for tests and local development
  .addOption(new Option("--admin-key <adminKey>").hideHelp())
  .addOption(new Option("--url <url>").hideHelp())
  .showHelpAfterError()
  .action(async cmdOptions => {
    const ctx = oneoffContext;
    const saveUrl = cmdOptions.saveUrl ? "yes" : "no";
    const projectConfig = (await readProjectConfig(ctx)).projectConfig;
    let adminKey = cmdOptions.adminKey;
    const url = cmdOptions.url ?? projectConfig.prodUrl;

    if (process.env.CONVEX_DEPLOY_KEY) {
      adminKey = process.env.CONVEX_DEPLOY_KEY;
    }

    const buildEnvironmentExpectsConvexDeployKey = buildEnvironment();

    if (!adminKey) {
      if (buildEnvironmentExpectsConvexDeployKey) {
        console.error(
          chalk.yellow(
            `${buildEnvironmentExpectsConvexDeployKey} build environment detected but CONVEX_DEPLOY_KEY is not set. Set this environment variable to deploy from this environment.`
          )
        );
        await ctx.crash(1);
      }
      adminKey = (
        await getUrlAndAdminKey(
          ctx,
          projectConfig.project,
          projectConfig.team,
          "prod"
        )
      ).adminKey;
    }

    await offerToWriteToEnv(ctx, "prod", url, saveUrl);

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
