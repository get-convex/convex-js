import { Command, Option } from "commander";
import {
  Context,
  logFailure,
  logFinishedStep,
  logOutput,
  oneoffContext,
  showSpinner,
} from "../bundler/context.js";
import { PushOptions, runPush } from "./lib/push.js";
import {
  bigBrainAPI,
  deploymentClient,
  deprecationCheckWarning,
  logAndHandleAxiosError,
  spawnAsync,
} from "./lib/utils.js";
import { runFunctionAndLog } from "./lib/run.js";
import {
  deploymentNameFromAdminKey,
  fetchProdDeploymentCredentials,
} from "./lib/api.js";
import { writeConvexUrlToEnvFile } from "./lib/envvars.js";
import * as dotenv from "dotenv";
import { version } from "../index.js";

export const preview = new Command("preview")
  .summary("Create a new preview deployment and push code to it")
  .description("TODO -- document this fully CX-4962")
  .argument(
    "<name>",
    "The name to associate with the preview deployment (e.g. git branch name)"
  )
  .option("-v, --verbose", "Show full listing of changes")
  .addOption(
    new Option(
      "--typecheck <mode>",
      `Check TypeScript files with \`tsc --noEmit\`.`
    )
      .choices(["enable", "try", "disable"])
      .default("try")
  )
  .addOption(
    new Option("--codegen <mode>", "Regenerate code in `convex/_generated/`")
      .choices(["enable", "disable"])
      .default("enable")
  )
  .option("--run <functionName>", "TODO -- document this fully CX-4962")
  .addOption(
    new Option(
      "--tail-logs",
      "Tail this project's Convex logs in this terminal."
    )
  )
  .addOption(
    new Option(
      "--envvars <mode>",
      "Sync environment variables starting with `CONVEX_PUBLIC_` to the preview deployment"
    )
      .choices(["sync", "skip"])
      .default("sync")
  )
  .addOption(
    new Option("--output <mode>")
      .choices(["url", "deploymentName", "deployKey"])
      .default("url")
      .hideHelp()
  )
  .addOption(new Option("--trace-events").hideHelp())
  .addOption(new Option("--admin-key <adminKey>").hideHelp())
  .addOption(new Option("--url <url>").hideHelp())
  // Options for testing
  .addOption(new Option("--override-auth-url <url>").hideHelp())
  .addOption(new Option("--override-auth-client <id>").hideHelp())
  .addOption(new Option("--override-auth-username <username>").hideHelp())
  .addOption(new Option("--override-auth-password <password>").hideHelp())
  .showHelpAfterError()
  .action(async (name, cmdOptions) => {
    const ctx = oneoffContext;
    const { adminKey } = await fetchProdDeploymentCredentials(ctx, cmdOptions);

    const data = await bigBrainAPI({
      ctx,
      method: "POST",
      url: "claim_preview_deployment",
      getAuthHeader: () => Promise.resolve(`Bearer ${adminKey}`),
      data: {
        identifier: name,
      },
    });

    const previewAdminKey = data.adminKey;
    const previewUrl = data.instanceUrl;
    if (cmdOptions.envvars === "sync") {
      await syncShellEnvVars({
        ctx,
        instanceUrl: previewUrl,
        adminKey: previewAdminKey,
      });
    }

    const options: PushOptions = {
      adminKey: previewAdminKey,
      verbose: !!cmdOptions.verbose,
      dryRun: false,
      typecheck: cmdOptions.typecheck,
      debug: !!cmdOptions.debug,
      debugBundlePath: cmdOptions.debugBundlePath,
      codegen: cmdOptions.codegen === "enable",
      url: previewUrl,
    };
    showSpinner(ctx, `Deploying to ${previewUrl}...`);
    await runPush(oneoffContext, options);
    logFinishedStep(ctx, `${"Deployed"} Convex functions to ${previewUrl}`);

    if (cmdOptions.run !== undefined) {
      await runFunctionAndLog(
        ctx,
        previewUrl,
        previewAdminKey,
        cmdOptions.run,
        {},
        {
          onSuccess: () => {
            logFinishedStep(
              ctx,
              `Finished running function "${cmdOptions.run}"`
            );
          },
        }
      );
    }
    await writeConvexUrlToEnvFile(ctx, previewUrl);
    if (cmdOptions.output === "url") {
      logOutput(ctx, previewUrl);
    } else if (cmdOptions.output === "deploymentName") {
      const deploymentName = await deploymentNameFromAdminKey(
        ctx,
        previewAdminKey
      );
      logOutput(ctx, deploymentName);
    }
  });

const CONVEX_PUBLIC_PREFIX = "CONVEX_PUBLIC_";

const syncShellEnvVars = async ({
  ctx,
  instanceUrl,
  adminKey,
}: {
  ctx: Context;
  instanceUrl: string;
  adminKey: string;
}) => {
  const { stdout } = await spawnAsync(ctx, "env", []);
  const config = dotenv.parse(stdout);
  const convexPublicEnvVars: Record<string, string> = {};

  Object.keys(config).forEach((envVarName) => {
    if (envVarName.startsWith(CONVEX_PUBLIC_PREFIX)) {
      convexPublicEnvVars[envVarName.substring(CONVEX_PUBLIC_PREFIX.length)] =
        config[envVarName];
    }
  });
  const envVarNames = Object.keys(convexPublicEnvVars);
  const envVarValues = Object.values(convexPublicEnvVars);
  const client = deploymentClient(instanceUrl);
  if (envVarNames.length > 0) {
    try {
      const res = await client.post(
        "/api/create_environment_variables",
        {
          names: envVarNames,
          values: envVarValues,
        },
        {
          headers: {
            "Convex-Client": `npm-cli-${version}`,
            Authorization: `Convex ${adminKey}`,
          },
        }
      );
      deprecationCheckWarning(ctx, res);
    } catch (err) {
      logFailure(
        ctx,
        `Error: Unable to create environment variables on ${instanceUrl}`
      );
      return await logAndHandleAxiosError(ctx, err);
    }
  }
};
