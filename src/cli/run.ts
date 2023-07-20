import { Command, Option } from "commander";
import { logFailure, oneoffContext } from "../bundler/context";
import { watchAndPush } from "./dev.js";
import { fetchDeploymentCredentialsProvisionProd } from "./lib/api.js";
import { runFunctionAndLog, subscribeAndLog } from "./lib/run";
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

    const { adminKey, url: deploymentUrl } =
      await fetchDeploymentCredentialsProvisionProd(ctx, options);

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
          watch: false,
        }
      );
    }

    if (options.watch) {
      return await subscribeAndLog(
        ctx,
        deploymentUrl,
        adminKey,
        functionName,
        args
      );
    }
    return await runFunctionAndLog(
      ctx,
      deploymentUrl,
      adminKey,
      functionName,
      args
    );
  });
