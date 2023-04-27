import chalk from "chalk";
import { functionsDir, ensureHasConvexDependency } from "./lib/utils";
import { Command } from "commander";
import { readConfig } from "./lib/config";
import { typeCheckFunctions } from "./lib/typecheck";
import { oneoffContext } from "./lib/context";

// Experimental (it's going to fail sometimes) TypeScript type checking.
// Includes a separate command to help users debug their TypeScript configs.

export type TypecheckResult = "cantTypeCheck" | "success" | "typecheckFailed";

/** Run the TypeScript compiler, as configured during  */
export const typecheck = new Command("typecheck")
  .description(
    "Run TypeScript typechecking on your Convex functions with `tsc --noEmit`."
  )
  .action(async () => {
    const ctx = oneoffContext;
    const { configPath, config: localConfig } = await readConfig(ctx, false);
    await ensureHasConvexDependency(ctx, "typecheck");
    await typeCheckFunctions(
      ctx,
      functionsDir(configPath, localConfig.projectConfig),
      async (typecheckResult, logSpecificError) => {
        logSpecificError?.();
        if (typecheckResult === "typecheckFailed") {
          console.error(chalk.gray("Typecheck failed"));
          return await ctx.crash(1, "invalid filesystem data");
        } else if (typecheckResult === "cantTypeCheck") {
          console.error(
            chalk.gray("Unable to typecheck; is TypeScript installed?")
          );
          return await ctx.crash(1, "invalid filesystem data");
        } else {
          console.error(
            chalk.green(
              "Typecheck passed: `tsc --noEmit` completed with exit code 0."
            )
          );
          return await ctx.crash(0);
        }
      }
    );
  });
