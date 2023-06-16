import { Command, Option } from "commander";
import ws from "ws";
import chalk from "chalk";
import util from "util";
import {
  oneoffContext,
  Context,
  logError,
  logOutput,
  logMessage,
  logFailure,
  logFinishedStep,
} from "../bundler/context";
import { getUrlAndAdminKeyForConfiguredDeployment } from "./lib/api.js";
import { BaseConvexClient, ConvexHttpClient } from "../browser/index.js";
import { convexToJson, Value } from "../values/value.js";
import { checkAuthorization, performLogin } from "./lib/login.js";
import { watchAndPush } from "./dev.js";
import { ensureHasConvexDependency } from "./lib/utils.js";

export const run = new Command("run")
  .description(
    "Run a Convex function (query, mutation, or action) after pushing local code."
  )
  .argument(
    "functionName",
    "identifier of the function to run, like `listMessages` or `dir/file:myFunction`"
  )
  .argument(
    "[args]",
    "JSON-formatted arguments object to pass to the function."
  )
  .option(
    "-w, --watch",
    "Watch a query, printing its result if the underlying data changes. Given function must be a query."
  )
  .option(
    "--no-push",
    "Do not push code to deployment before running the function."
  )
  .option(
    "--prod",
    "Run the function on this project's production deployment, instead of the configured deployment. Can only be used with --no-push."
  )
  .addOption(new Option("--url <url>").hideHelp())
  .addOption(new Option("--admin-key <adminKey>").hideHelp())

  // Options for the implicit dev deploy
  .addOption(
    new Option(
      "--typecheck <mode>",
      `Whether to check TypeScript files with \`tsc --noEmit\`.`
    )
      .choices(["enable", "try", "disable"])
      .default("try")
  )
  .addOption(
    new Option("--codegen <mode>", "Regenerate code in `convex/_generated/`")
      .choices(["enable", "disable"])
      .default("enable")
  )

  .showHelpAfterError()
  .action(async (functionName, argsString, options) => {
    const ctx = oneoffContext;

    if (!options.url || !options.adminKey) {
      if (!(await checkAuthorization(ctx, false))) {
        await performLogin(ctx, options);
      }
    }

    const { adminKey, url: deploymentUrl } =
      await getUrlAndAdminKeyForConfiguredDeployment(ctx, options);

    await ensureHasConvexDependency(ctx, "run");

    const args = argsString ? JSON.parse(argsString) : {};

    if (options.prod && options.push) {
      logFailure(
        ctx,
        `\`convex run\` doesn't push functions to prod automatically.
Use --no-push to run functions that are already deployed.`
      );
      return await ctx.crash(1, "fatal");
    }

    if (options.push) {
      await watchAndPush(
        ctx,
        {
          adminKey,
          verbose: !!options.verbose,
          dryRun: false,
          typecheck: options.typecheck,
          debug: false,
          codegen: options.codegen === "enable",
          url: deploymentUrl,
        },
        {
          once: true,
          traceEvents: false,
        }
      );
    }

    if (options.watch) {
      return await subscribe(ctx, deploymentUrl, functionName, args);
    }
    return await runFunction(ctx, deploymentUrl, adminKey, functionName, args);
  });

async function runFunction(
  ctx: Context,
  deploymentUrl: string,
  adminKey: string,
  functionName: string,
  args: Value
) {
  const client = new ConvexHttpClient(deploymentUrl);
  client.setAdminAuth(adminKey);

  let result: Value;
  try {
    result = await client.function(functionName, args);
  } catch (err) {
    logFailure(ctx, `Failed to run function "${functionName}":`);
    logError(ctx, chalk.red(err));
    return await ctx.crash(1);
  }

  // `null` is the default return type
  if (result !== null) {
    logOutput(ctx, formatValue(result));
  }
}

function formatValue(value: Value) {
  const json = convexToJson(value);
  if (process.stdout.isTTY) {
    // TODO (Tom) add JSON syntax highlighting like https://stackoverflow.com/a/51319962/398212
    // until then, just spit out something that isn't quite JSON because it's easy
    return util.inspect(value, { colors: true, depth: null });
  } else {
    return JSON.stringify(json, null, 2);
  }
}

async function subscribe(
  ctx: Context,
  deployment: string,
  functionName: string,
  args: Record<string, Value>
) {
  const client = new BaseConvexClient(
    deployment,
    updatedQueries => {
      for (const _ of updatedQueries) {
        logOutput(
          ctx,
          formatValue(client.localQueryResult(functionName, args)!)
        );
      }
    },
    {
      // pretend that a Node.js 'ws' library WebSocket is a browser WebSocket
      webSocketConstructor: ws as unknown as typeof WebSocket,
      unsavedChangesWarning: false,
    }
  );
  const { unsubscribe } = client.subscribe(functionName, args);
  logFinishedStep(ctx, `Watching query ${functionName} on ${deployment}...`);

  let done = false;
  let onDone: (v: unknown) => void;
  const doneP = new Promise(resolve => (onDone = resolve));
  function sigintListener() {
    logMessage(ctx, `Closing connection to ${deployment}...`);
    unsubscribe();
    void client.close();
    process.off("SIGINT", sigintListener);
    done = true;
    onDone(null);
  }
  process.on("SIGINT", sigintListener);
  while (!done) {
    // loops once per day (any large value < 2**31 would work)
    const oneDay = 24 * 60 * 60 * 1000;
    await Promise.race([
      doneP,
      new Promise(resolve => setTimeout(resolve, oneDay)),
    ]);
  }
}
