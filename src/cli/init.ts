import { Command, Option } from "commander";
import path from "path";
import { oneoffContext } from "../bundler/context.js";
import { initOrReinitForDeprecatedCommands } from "./lib/init.js";
import { checkAuthorization, performLogin } from "./lib/login.js";

const cwd = path.basename(process.cwd());

/** Initialize a new Convex project. */
export const init = new Command("init")
  .description("Initialize a new Convex project in the current directory")
  .option(
    "--project <name>",
    `Name of the project to create. Defaults to \`${cwd}\` (the current directory)`
  )
  .addOption(
    new Option(
      "--team <slug>",
      "Slug identifier for the team this project will belong to."
    )
  )
  .option(
    "--save-url",
    "Save the production deployment URL to .env or .env.production."
  )
  .option(
    "--no-save-url",
    "Do not save production deployment URL to a .env file."
  )
  .action(async options => {
    const ctx = oneoffContext;

    if (!(await checkAuthorization(ctx, false))) {
      await performLogin(ctx);
    }

    await initOrReinitForDeprecatedCommands(ctx, options);
  });
