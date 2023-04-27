import { Command, Option } from "commander";
import {
  AuthInfo,
  readProjectConfig,
  writeProjectConfig,
} from "./lib/config.js";
import inquirer from "inquirer";
import chalk from "chalk";
import { oneoffContext } from "./lib/context.js";
import { validateIdentityProviderURL } from "./lib/auth.js";

const list = new Command("list")
  .description("List the currently-configured identity providers")
  .action(async () => {
    const { projectConfig } = await readProjectConfig(oneoffContext);
    const auth = projectConfig.authInfo;
    for (let i = 0; i < auth.length; i++) {
      console.log(
        `${i + 1}. Issuer: "${auth[i].domain}", Application ID: "${
          auth[i].applicationID
        }"`
      );
    }
  });

const rm = new Command("remove")
  .description("Remove one or more identity providers from the config")
  .action(async (_, command) => {
    const ctx = oneoffContext;
    const options = command.parent.opts();
    const { projectConfig } = await readProjectConfig(ctx);
    const auth = projectConfig.authInfo;
    if (auth.length === 0) {
      console.log(
        chalk.yellow("No identity providers configured -- nothing to remove.")
      );
      return;
    }
    const answers = await inquirer.prompt([
      {
        type: "checkbox",
        message: "Choose which provider(s) to delete:",
        choices: auth.map(info => {
          return {
            name: `Issuer: "${info.domain}", Application ID: "${info.applicationID}"`,
            value: info,
          };
        }),
        name: "providers",
      },
    ]);
    const toRemove: AuthInfo[] = answers.providers ?? [];
    if (toRemove.length === 0) {
      console.log(chalk.green("No providers selected for removal."));
      return;
    }
    const newAuth = auth.filter(oldInfo => toRemove.indexOf(oldInfo) < 0);
    if (options.verbose) {
      console.log(
        chalk.bold(
          `Removing ${toRemove.length} identity provider(s). After this operation, the following provider(s) will remain:`
        )
      );
      for (let i = 0; i < newAuth.length; i++) {
        console.log(
          `${i + 1}. Issuer: "${newAuth[i].domain}", Application ID: "${
            newAuth[i].applicationID
          }"`
        );
      }
      await inquirer.prompt(["Press enter to continue or ctrl-C to abort.\n"]);
    }
    const newConfig = projectConfig;
    newConfig.authInfo = newAuth;
    await writeProjectConfig(ctx, newConfig);
    console.log(
      chalk.green(
        "Configuration updated. Run `npx convex dev` or `npx convex deploy` to sync these changes."
      )
    );
  });

const add = new Command("add")
  .description("Add an identity provider to the config")
  .addOption(new Option("--identity-provider-url <url>").hideHelp())
  .addOption(new Option("--application-id <applicationId>").hideHelp())
  .action(async (options, command) => {
    const ctx = oneoffContext;
    const verbose = command.parent.opts().verbose;
    const { projectConfig } = await readProjectConfig(ctx);
    const newProviders: AuthInfo[] = [];
    async function ask() {
      await inquirer
        .prompt([
          {
            type: "input",
            name: "domain",
            message:
              "Enter the identity provider's Domain URL, (e.g. `{your auth0 domain}.us.auth0.com`):",
            filter: validateIdentityProviderURL,
          },
          {
            type: "input",
            name: "applicationID",
            message:
              "Enter your application/client ID with this identity provider:",
            validate: (id: string) => {
              if (id.startsWith('"')) {
                return "Client ID should not be quoted";
              }
              return true;
            },
          },
          {
            type: "confirm",
            name: "anotherOne",
            message: "Would you like to add another provider?",
            default: false,
          },
        ])
        .then(async answers => {
          newProviders.push({
            domain: answers.domain,
            applicationID: answers.applicationID,
          });
          if (answers.anotherOne) {
            await ask();
          }
        });
    }

    if (options.identityProviderUrl && options.applicationId) {
      newProviders.push({
        domain: options.identityProviderUrl,
        applicationID: options.applicationId,
      });
    } else {
      await ask();
    }

    if (newProviders.length === 0) {
      console.log(chalk.yellow("No providers added; nothing to do."));
      return;
    }
    if (verbose) {
      console.log(chalk.bold("Will add the following identity providers:"));
      for (let i = 0; i < newProviders.length; i++) {
        console.log(
          `${i + 1}. Issuer: "${newProviders[i].domain}", Application ID: "${
            newProviders[i].applicationID
          }"`
        );
      }
      await inquirer.prompt(["Press enter to continue or ctrl-C to abort.\n"]);
    }
    const config = projectConfig;
    config.authInfo.push(...newProviders);
    await writeProjectConfig(ctx, config);
    console.log(
      chalk.green(
        "Configuration updated. Run `npx convex dev` or `npx convex deploy` to sync these changes."
      )
    );
  });

export const auth = new Command("auth")
  .description("Modify the authentication config")
  .option("-v, --verbose", "Show changes and prompt for confirmation")
  .addCommand(list)
  .addCommand(rm)
  .addCommand(add);
