import { Command } from "commander";
import { checkAuthorization, performLogin } from "./lib/login.js";
import path from "path";
import { Option } from "commander";
import { oneoffContext } from "./lib/context.js";
import { init as initLib } from "./lib/init.js";

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

    if (!(await checkAuthorization(ctx))) {
      await performLogin(ctx);
    }

    const saveUrl =
      options.saveUrl === true
        ? "yes"
        : options.saveUrl === false
        ? "no"
        : "ask";
    await initLib(ctx, options, saveUrl);
  });
