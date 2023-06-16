import { Command, Option } from "commander";
import { oneoffContext } from "../bundler/context.js";
import { initOrReinitForDeprecatedCommands } from "./lib/init.js";

export const reinit = new Command("reinit")
  .description(
    "Reinitialize a Convex project in the local directory if you've lost your convex.json file"
  )
  .addOption(
    new Option(
      "--team <team_slug>",
      "The identifier of the team the project belongs to."
    )
  )
  .addOption(
    new Option(
      "--project <project_slug>",
      "The identifier of the project you'd like to reinitialize."
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

    await initOrReinitForDeprecatedCommands(ctx, options);
  });
