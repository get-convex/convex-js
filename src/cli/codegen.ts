import { Command, Option } from "commander";
import { readProjectConfig } from "./lib/config.js";
import chalk from "chalk";
import { functionsDir, ensureHasConvexDependency } from "./lib/utils.js";
import { doInitCodegen, doCodegen } from "./lib/codegen";
import { oneoffContext } from "./lib/context.js";

export const codegen = new Command("codegen")
  .summary("Generate backend type definitions")
  .description(
    "Generate types in `convex/_generated/` based on the current contents of `convex/`."
  )
  .option(
    "--dry-run",
    "Print out the generated configuration to stdout instead of writing to convex directory"
  )
  .addOption(new Option("--debug").hideHelp())
  .addOption(
    new Option(
      "--typecheck <mode>",
      `Whether to check TypeScript files with \`tsc --noEmit\`.`
    )
      .choices(["enable", "try", "disable"])
      .default("try")
  )
  .option(
    "--init",
    "Also write the default convex/README.md and convex/tsconfig.json, otherwise only written during convex dev."
  )
  // Experimental option
  .addOption(
    new Option(
      "--commonjs",
      "Generate CommonJS modules (CJS) instead of ECMAScript modules, the default. Bundlers typically take care of this conversion while bundling, so this setting is generally only useful for projects which do not use a bundler, typically Node.js projects. Convex functions can be written with either syntax."
    ).hideHelp()
  )
  .action(async options => {
    const ctx = oneoffContext;
    const { projectConfig, configPath } = await readProjectConfig(ctx);
    // This also ensures the current directory is the project root.
    await ensureHasConvexDependency(ctx, "codegen");

    if (options.init) {
      await doInitCodegen(
        ctx,
        functionsDir(configPath, projectConfig),
        false,
        options.dryRun,
        options.debug
      );
    }

    if (options.typecheck !== "disable") {
      console.error(chalk.gray("Running TypeScript typecheck…"));
    }

    await doCodegen({
      ctx,
      projectConfig,
      configPath,
      typeCheckMode: options.typecheck,
      dryRun: options.dryRun,
      debug: options.debug,
      commonjs: options.commonjs,
    });
    chalk.green("Codegen finished.");
  });
