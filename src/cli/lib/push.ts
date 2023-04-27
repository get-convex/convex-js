import chalk from "chalk";
import {
  pullConfig,
  pushConfig,
  diffConfig,
  readProjectConfig,
  configJSON,
  configFromProjectConfig,
} from "./config.js";
import { functionsDir, ensureHasConvexDependency } from "./utils.js";
import { typeCheckFunctionsInMode } from "./typecheck.js";
import { doCodegen } from "./codegen";
import { pushSchema } from "./indexes.js";
import { Context } from "./context.js";

export type PushOptions = {
  adminKey: string;
  verbose: boolean;
  dryRun: boolean;
  typecheck: "enable" | "try" | "disable";
  debug: boolean;
  debugBundlePath?: string;
  codegen: boolean;
  url: string;
};

export async function runPush(ctx: Context, options: PushOptions) {
  const { configPath, projectConfig } = await readProjectConfig(ctx);
  const origin = options.url;
  const verbose = options.verbose || options.dryRun;
  await ensureHasConvexDependency(ctx, "push");

  if (!options.codegen) {
    console.error(
      chalk.gray("Skipping codegen. Remove --codegen=disable to enable.")
    );
    // Codegen includes typechecking, so if we're skipping it, run the type
    // check manually on the query and mutation functions
    const funcDir = functionsDir(configPath, projectConfig);
    await typeCheckFunctionsInMode(ctx, options.typecheck, funcDir);
  } else {
    await doCodegen({
      ctx,
      projectConfig,
      configPath,
      typeCheckMode: options.typecheck,
      dryRun: options.dryRun,
      debug: options.debug,
      quiet: true,
    });
    if (verbose) {
      console.error(chalk.green("Codegen finished."));
    }
  }

  const localConfig = await configFromProjectConfig(
    ctx,
    projectConfig,
    configPath,
    verbose
  );

  if (options.debugBundlePath) {
    const config = configJSON(localConfig, options.adminKey);
    ctx.fs.writeUtf8File(options.debugBundlePath, JSON.stringify(config));
    return;
  }

  const { schemaId, schemaState } = await pushSchema(
    ctx,
    origin,
    options.adminKey,
    functionsDir(configPath, localConfig.projectConfig),
    options.dryRun
  );

  const remoteConfig = await pullConfig(
    ctx,
    localConfig.projectConfig.project,
    localConfig.projectConfig.team,
    origin,
    options.adminKey
  );

  const diff = diffConfig(remoteConfig, localConfig);
  if (diff === "" && schemaState?.state === "active") {
    if (verbose) {
      const msg =
        localConfig.modules.length === 0
          ? `No functions found in ${localConfig.projectConfig.functions}`
          : "Config already synced";
      console.log(
        chalk.gray(
          `${
            options.dryRun
              ? "Command would skip function push"
              : "Function push skipped"
          }: ${msg}.`
        )
      );
    }
    return;
  }

  if (verbose) {
    console.log(
      chalk.bold(
        `Remote config ${
          options.dryRun ? "would" : "will"
        } be overwritten with the following changes:`
      )
    );
    console.log(diff);
  }

  if (options.dryRun) {
    return;
  }

  await pushConfig(ctx, localConfig, options.adminKey, options.url, schemaId);
}
