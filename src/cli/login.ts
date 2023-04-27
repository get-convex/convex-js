import { Command, Option } from "commander";
import chalk from "chalk";
import { oneoffContext } from "./lib/context.js";
import { checkAuthorization, performLogin } from "./lib/login.js";

export const login = new Command("login")
  .description("Login to Convex")
  .option(
    "--device-name <name>",
    "Provide a name for the device being authorized"
  )
  .option(
    "-f, --force",
    "Proceed with login even if a valid access token already exists for this device"
  )
  .option(
    "--no-open",
    "Don't automatically open the login link in the default browser"
  )
  // These options are hidden from the help/usage message, but allow overriding settings for testing.
  .addOption(new Option("--override-auth-url <url>").hideHelp())
  .addOption(new Option("--override-auth-client <id>").hideHelp())
  .addOption(new Option("--override-auth-username <username>").hideHelp())
  .addOption(new Option("--override-auth-password <password>").hideHelp())
  .addOption(new Option("--no-opt-in").hideHelp())
  .action(async (options, cmd: Command) => {
    const ctx = oneoffContext;
    if ((await checkAuthorization(ctx)) && !options.force) {
      console.log(
        chalk.green(
          "This device has previously been authorized and is ready for use with Convex."
        )
      );
      return;
    }
    if (!!options.overrideAuthUsername !== !!options.overrideAuthPassword) {
      cmd.error(
        "If overriding credentials, both username and password must be provided"
      );
    }

    await performLogin(ctx, options);
  });
