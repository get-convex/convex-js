import chalk from "chalk";
import { Command, Option } from "commander";
import inquirer from "inquirer";
import {
  Context,
  logError,
  logFinishedStep,
  logMessage,
  logOutput,
  oneoffContext,
  showSpinner,
} from "../bundler/context.js";
import {
  CONVEX_DEPLOY_KEY_ENV_VAR_NAME,
  deploymentNameFromAdminKey,
  fetchProdDeploymentCredentials,
  readConfiguredAdminKey,
} from "./lib/api.js";
import {
  gitBranchFromEnvironment,
  isNonProdBuildEnvironment,
  suggestedEnvVarName,
} from "./lib/envvars.js";
import { PushOptions, runPush } from "./lib/push.js";
import { bigBrainAPI } from "./lib/utils.js";
import { spawnSync } from "child_process";
import { runFunctionAndLog } from "./lib/run.js";

export const deploy = new Command("deploy")
  .description("Deploy to a Convex deployment")
  .option("-v, --verbose", "Show full listing of changes")
  .option(
    "--dry-run",
    "Print out the generated configuration without deploying to your Convex deployment"
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
  .addOption(
    new Option(
      "--cmd <command>",
      "Command to run as part of deploying your app (e.g. `vite build`). This command can depend on the environment variables specified in `--cmd-url-env-var-name` being set."
    )
  )
  .addOption(
    new Option(
      "--cmd-url-env-var-name <name>",
      "Environment variable name to set Convex deployment URL (e.g. `VITE_CONVEX_URL`) when using `--cmd`"
    )
  )
  .addOption(
    new Option(
      "--preview-run <functionName>",
      "Function to run if deploying to a preview deployment. This is ignored if deploying to a production deployment."
    )
  )
  .addOption(
    new Option(
      "--preview-name <name>",
      "The name to associate with this deployment if deploying to a preview deployment. Defaults to the current Git branch name in Vercel, Netlify and Github CI. This is ignored if deploying to a production deployment."
    )
  )
  .addOption(
    new Option(
      "--check-build-environment",
      "Whether to check for a non-production build environment before deploying to a production Convex deployment."
    )
      .choices(["enable", "disable"])
      .default("enable")
      .hideHelp()
  )

  .addOption(new Option("--debug-bundle-path <path>").hideHelp())
  .addOption(new Option("--debug").hideHelp())
  // Hidden options to pass in admin key and url for tests and local development
  .addOption(new Option("--admin-key <adminKey>").hideHelp())
  .addOption(new Option("--url <url>").hideHelp())
  .addOption(new Option("--log-deployment-name").hideHelp())
  .showHelpAfterError()
  .action(
    async (cmdOptions: {
      verbose: boolean | undefined;
      dryRun: boolean | undefined;
      yes: boolean | undefined;
      typecheck: "enable" | "try" | "disable";
      codegen: "enable" | "disable";
      cmd: string | undefined;
      cmdUrlEnvVarName: string | undefined;
      previewRun: string | undefined;
      previewName: string | undefined;

      checkBuildEnvironment: "enable" | "disable";
      debugBundlePath: string | undefined;
      debug: boolean | undefined;
      adminKey: string | undefined;
      url: string | undefined;
      logDeploymentName: boolean | undefined;
    }) => {
      const ctx = oneoffContext;

      const configuredDeployKey =
        readConfiguredAdminKey(cmdOptions.adminKey) ?? null;
      if (
        cmdOptions.checkBuildEnvironment === "enable" &&
        isNonProdBuildEnvironment() &&
        configuredDeployKey?.startsWith("prod:")
      ) {
        logError(
          ctx,
          `Detected a non-production build environment and "${CONVEX_DEPLOY_KEY_ENV_VAR_NAME}" for a production Convex deployment.\n
          This is probably unintentional.
          `
        );
        await ctx.crash(1);
      }

      if (
        configuredDeployKey !== null &&
        configuredDeployKey.startsWith("preview:")
      ) {
        await handlePreview(ctx, { ...cmdOptions, configuredDeployKey });
      } else {
        await handleProduction(ctx, cmdOptions);
      }
    }
  );

async function handlePreview(
  ctx: Context,
  options: {
    configuredDeployKey: string;
    dryRun: boolean | undefined;
    previewName: string | undefined;
    previewRun: string | undefined;
    cmdUrlEnvVarName: string | undefined;
    cmd: string | undefined;
    verbose: boolean | undefined;
    typecheck: "enable" | "try" | "disable";
    codegen: "enable" | "disable";

    debug: boolean | undefined;
    debugBundlePath: string | undefined;
    logDeploymentName: boolean | undefined;
  }
) {
  const previewName = options.previewName ?? gitBranchFromEnvironment();
  if (previewName === null) {
    logError(
      ctx,
      "`npx convex deploy` to a preview deployment could not determine the preview name. Provide one using `--preview-name`"
    );
    await ctx.crash(1);
  }

  if (options.dryRun) {
    logFinishedStep(
      ctx,
      `Would have claimed preview deployment for "${previewName}"`
    );
    await runCommand(ctx, {
      cmdUrlEnvVarName: options.cmdUrlEnvVarName,
      cmd: options.cmd,
      dryRun: !!options.dryRun,
      url: "https://<PREVIEW DEPLOYMENT>.convex.cloud",
    });
    logFinishedStep(
      ctx,
      `Would have deployed Convex functions to preview deployment for "${previewName}"`
    );
    if (options.previewRun !== undefined) {
      logMessage(ctx, `Would have run function "${options.previewRun}"`);
    }
    return;
  }

  const data = await bigBrainAPI({
    ctx,
    method: "POST",
    url: "claim_preview_deployment",
    getAuthHeader: () =>
      Promise.resolve(`Bearer ${options.configuredDeployKey}`),
    data: {
      identifier: previewName,
    },
  });

  const previewAdminKey = data.adminKey;
  const previewUrl = data.instanceUrl;

  await runCommand(ctx, { ...options, url: previewUrl });

  const pushOptions: PushOptions = {
    adminKey: previewAdminKey,
    verbose: !!options.verbose,
    dryRun: false,
    typecheck: options.typecheck,
    debug: !!options.debug,
    debugBundlePath: options.debugBundlePath,
    codegen: options.codegen === "enable",
    url: previewUrl,
  };
  showSpinner(ctx, `Deploying to ${previewUrl}...`);
  await runPush(oneoffContext, pushOptions);
  logFinishedStep(ctx, `Deployed Convex functions to ${previewUrl}`);

  if (options.previewRun !== undefined) {
    await runFunctionAndLog(
      ctx,
      previewUrl,
      previewAdminKey,
      options.previewRun,
      {},
      {
        onSuccess: () => {
          logFinishedStep(
            ctx,
            `Finished running function "${options.previewRun}"`
          );
        },
      }
    );
  }
  if (options.logDeploymentName) {
    const deploymentName = await deploymentNameFromAdminKey(
      ctx,
      previewAdminKey
    );
    logOutput(ctx, deploymentName);
  }
}

async function handleProduction(
  ctx: Context,
  options: {
    verbose: boolean | undefined;
    dryRun: boolean | undefined;
    yes: boolean | undefined;
    typecheck: "enable" | "try" | "disable";
    codegen: "enable" | "disable";
    cmd: string | undefined;
    cmdUrlEnvVarName: string | undefined;

    debugBundlePath: string | undefined;
    debug: boolean | undefined;
    adminKey: string | undefined;
    url: string | undefined;
    logDeploymentName: boolean | undefined;
  }
) {
  const { adminKey, url, deploymentNames } =
    await fetchProdDeploymentCredentials(ctx, options);
  if (deploymentNames !== undefined) {
    const shouldPushToProd =
      deploymentNames.prod === deploymentNames.configured ||
      (options.yes ?? (await askToConfirmPush(ctx, deploymentNames, url)));
    if (!shouldPushToProd) {
      await ctx.crash(1);
    }
  }

  await runCommand(ctx, { ...options, url });

  const pushOptions: PushOptions = {
    adminKey,
    verbose: !!options.verbose,
    dryRun: !!options.dryRun,
    typecheck: options.typecheck,
    debug: !!options.debug,
    debugBundlePath: options.debugBundlePath,
    codegen: options.codegen === "enable",
    url,
  };
  showSpinner(
    ctx,
    `Deploying to ${url}...${options.dryRun ? " [dry run]" : ""}`
  );
  await runPush(oneoffContext, pushOptions);
  logFinishedStep(
    ctx,
    `${
      options.dryRun ? "Would have deployed" : "Deployed"
    } Convex functions to ${url}`
  );
  if (options.logDeploymentName) {
    const deploymentName = await deploymentNameFromAdminKey(ctx, adminKey);
    logOutput(ctx, deploymentName);
  }
}

async function runCommand(
  ctx: Context,
  options: {
    cmdUrlEnvVarName: string | undefined;
    cmd: string | undefined;
    dryRun: boolean | undefined;
    url: string;
  }
) {
  if (options.cmd === undefined) {
    return;
  }

  const urlVar =
    options.cmdUrlEnvVarName ?? (await suggestedEnvVarName(ctx)).envVar;
  showSpinner(
    ctx,
    `Running '${options.cmd}' with environment variable "${urlVar}" set...${
      options.dryRun ? " [dry run]" : ""
    }`
  );
  if (!options.dryRun) {
    const env = { ...process.env };
    env[urlVar] = options.url;
    spawnSync(options.cmd, {
      env,
      stdio: "inherit",
      shell: true,
    });
  }
  logFinishedStep(
    ctx,
    `${options.dryRun ? "Would have run" : "Ran"} "${
      options.cmd
    }" with environment variable "${urlVar}" set`
  );
}

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
