import { Command, Option } from "commander";
import {
  getProdUrlAndAdminKey,
  getUrlAndAdminKeyByDeploymentType,
} from "./lib/api";
import {
  ProjectConfig,
  enforceDeprecatedConfigField,
  readProjectConfig,
} from "./lib/config";
import {
  logFailure,
  logFinishedStep,
  logMessage,
  oneoffContext,
  showSpinner,
  Context,
} from "../bundler/context";
import { buildEnvironment, suggestedEnvVarName } from "./lib/envvars";
import { PushOptions, runPush } from "./lib/push";
import { getAuthHeader } from "./lib/utils";
import inquirer from "inquirer";
import chalk from "chalk";
import {
  readDeploymentEnvVar,
  stripDeploymentTypePrefix,
} from "./lib/deployment";

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
  // deprecated
  .addOption(new Option("--no-save-url").hideHelp())
  .showHelpAfterError()
  .action(async cmdOptions => {
    const ctx = oneoffContext;

    const projectConfig = (await readProjectConfig(ctx)).projectConfig;

    let adminKey =
      cmdOptions.adminKey ?? process.env.CONVEX_DEPLOY_KEY ?? undefined;
    let url =
      cmdOptions.url ??
      (await deriveUrlFromAdminKey(ctx, projectConfig, adminKey));

    const configuredDeployment = readDeploymentEnvVar();

    // Crash if we know that DEPLOY_KEY (adminKey) is required
    if (adminKey === undefined) {
      const buildEnvironmentExpectsConvexDeployKey = buildEnvironment();
      if (buildEnvironmentExpectsConvexDeployKey) {
        logFailure(
          ctx,
          `${buildEnvironmentExpectsConvexDeployKey} build environment detected but CONVEX_DEPLOY_KEY is not set. Set this environment variable to deploy from this environment.`
        );
        await ctx.crash(1);
      }
      const header = await getAuthHeader(ctx);
      if (!header) {
        logFailure(
          ctx,
          "Error: You are not logged in. Log in with `npx convex dev` or set the CONVEX_DEPLOY_KEY environment variable."
        );
        await ctx.crash(1);
      }
    }

    // Derive the missing adminKey or URL from:
    //   - new path: CONVEX_DEPLOYMENT
    //   - old path: projectConfig
    if (adminKey === undefined || url === undefined) {
      if (configuredDeployment) {
        const configuredDeploymentName =
          stripDeploymentTypePrefix(configuredDeployment);
        const prodDeploymentInfo = await getProdUrlAndAdminKey(
          ctx,
          configuredDeploymentName
        );
        const prodDeploymentName = prodDeploymentInfo.deploymentName;
        adminKey ??= prodDeploymentInfo.adminKey;
        url ??= prodDeploymentInfo.url;
        const shouldPushToProd =
          prodDeploymentName === configuredDeploymentName ||
          (cmdOptions.yes ??
            (await askToConfirmPush(
              ctx,
              configuredDeploymentName,
              prodDeploymentName,
              url
            )));
        if (!shouldPushToProd) {
          await ctx.crash(1);
        }
      }
      // deprecated path
      else if (
        projectConfig.project &&
        projectConfig.team
        // TODO: Add this once we start promoting new path
        // && projectConfig.prodUrl
      ) {
        url ??= await enforceDeprecatedConfigField(
          ctx,
          projectConfig,
          "prodUrl"
        );
        adminKey ??= (
          await getUrlAndAdminKeyByDeploymentType(
            ctx,
            projectConfig.project,
            projectConfig.team,
            "prod"
          )
        ).adminKey;
      } else {
        logFailure(
          ctx,
          "No CONVEX_DEPLOYMENT set, run `npx convex dev` to configure a Convex project"
        );
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

// This returns the the url of the deployment if the admin key is in the new format
// like "tall-forest-1234|1235123541527341273541"
//   or "prod:tall-forest-1234|1235123541527341273541"
async function deriveUrlFromAdminKey(
  ctx: Context,
  projectConfig: ProjectConfig,
  adminKey: string | undefined
) {
  if (adminKey) {
    const parts = adminKey.split("|");
    if (parts.length === 1) {
      if (projectConfig.prodUrl) {
        return projectConfig.prodUrl;
      }
      logFailure(
        ctx,
        "Please set CONVEX_DEPLOY_KEY to a new key which you can find on your Convex dashboard."
      );
      await ctx.crash(1);
    }
    const deploymentName = stripDeploymentTypePrefix(parts[0]);
    return `https://${deploymentName}.convex.cloud`;
  }
  return undefined;
}

async function askToConfirmPush(
  ctx: Context,
  configuredDeployment: string,
  prodDeployment: string,
  prodUrl: string
) {
  logMessage(
    ctx,
    `\
You're currently developing against your ${chalk.bold("dev")} deployment

  ${configuredDeployment} (set in CONVEX_DEPLOYMENT)

Your ${chalk.bold("prod")} deployment ${chalk.bold(
      prodDeployment
    )} serves traffic at:

  ${(await suggestedEnvVarName(ctx)).envVar}=${chalk.bold(prodUrl)}

Make sure that your published client is configured with this URL (for instructions see https://docs.convex.dev/hosting)\n`
  );
  return (
    await inquirer.prompt([
      {
        type: "confirm",
        name: "shouldPush",
        message: `Do you want to push your code to your prod deployment ${prodDeployment} now?`,
        default: true,
      },
    ])
  ).shouldPush;
}
