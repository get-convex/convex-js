import { Option } from "commander";
import { logFailure, oneoffContext } from "../bundler/context.js";
import { watchAndPush } from "./dev.js";
import {
  fetchDeploymentCredentialsProvisionProd,
  deploymentSelectionFromOptions,
} from "./lib/api.js";
import { runFunctionAndLog, subscribeAndLog } from "./lib/run.js";
import { DeploymentCommand, ensureHasConvexDependency } from "./lib/utils.js";

export const run = new DeploymentCommand("run")
  .description("Run a function (query, mutation, or action) on your deployment")
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
  .option("--push", "Push code to deployment before running the function.")
  // For backwards compatibility we still support --no-push which is a noop
  .addOption(new Option("--no-push").hideHelp())
  .addDeploymentSelectionOptions("Run the function on")
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

    const deploymentSelection = deploymentSelectionFromOptions(options);

    const {
      adminKey,
      url: deploymentUrl,
      deploymentType,
    } = await fetchDeploymentCredentialsProvisionProd(ctx, deploymentSelection);

    await ensureHasConvexDependency(ctx, "run");

    const args = argsString ? JSON.parse(argsString) : {};

    if (deploymentType === "prod" && options.push) {
      logFailure(
        ctx,
        `\`convex run\` doesn't support pushing functions to prod deployments. ` +
          `Remove the --push flag. To push to production use \`npx convex deploy\`.`
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
          untilSuccess: true,
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
