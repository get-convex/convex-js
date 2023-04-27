import { Command, Option } from "commander";
import { oneoffContext } from "./lib/context.js";
import { reinit as reinitLib } from "./lib/reinit.js";

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

    const saveUrl =
      options.saveUrl === true
        ? "yes"
        : options.saveUrl === false
        ? "no"
        : "ask";
    await reinitLib(ctx, options, saveUrl);
  });
