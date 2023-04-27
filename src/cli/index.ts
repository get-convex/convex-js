#!/usr/bin/env node
/* eslint-disable no-restricted-syntax */
import { Command } from "commander";
import { init } from "./init.js";
import { dashboard } from "./dashboard.js";
import { deployments } from "./deployments.js";
import { docs } from "./docs.js";
import { version } from "../index.js";
import { auth } from "./auth.js";
import { codegen } from "./codegen.js";
import { reinit } from "./reinit.js";
import { update } from "./update.js";
import { typecheck } from "./typecheck.js";
import { login } from "./login.js";
import chalk from "chalk";
import * as Sentry from "@sentry/node";
import "@sentry/tracing";
import stripAnsi from "strip-ansi";
import { productionProvisionHost, provisionHost } from "./lib/config.js";
import { convexImport } from "./convexImport.js";
import { dev } from "./dev.js";
import { deploy } from "./deploy.js";

const MINIMUM_MAJOR_VERSION = 14;

async function main() {
  // If you want to use `@sentry/tracing` in your project directly, use a named import instead:
  // import * as SentryTracing from "@sentry/tracing"
  // Unused named imports are not guaranteed to patch the global hub.

  if (!process.env.CI && provisionHost === productionProvisionHost) {
    Sentry.init({
      dsn: "https://f9fa0306e3d540079cf40ce8c2ad9644@o1192621.ingest.sentry.io/6390839",
      release: "cli@" + version,
      tracesSampleRate: 0.2,
      beforeBreadcrumb: breadcrumb => {
        // Strip ANSI color codes from log lines that are sent as breadcrumbs.
        if (breadcrumb.message) {
          breadcrumb.message = stripAnsi(breadcrumb.message);
        }
        return breadcrumb;
      },
    });
  }

  const nodeVersion = process.versions.node;
  const majorVersion = parseInt(nodeVersion.split(".")[0], 10);
  if (majorVersion < MINIMUM_MAJOR_VERSION) {
    console.log(
      chalk.red(
        `Your Node version ${nodeVersion} is too old. Convex requires at least Node v${MINIMUM_MAJOR_VERSION}.`
      )
    );
    console.log(
      chalk.gray(
        `You can use ${chalk.bold(
          "nvm"
        )} (https://github.com/nvm-sh/nvm#installing-and-updating) to manage different versions of Node.`
      )
    );
    console.log(
      chalk.gray(
        "After installing `nvm`, install the latest version of Node with " +
          chalk.bold("`nvm install node`.")
      )
    );
    console.log(
      chalk.gray(
        "Then, activate the installed version in your terminal with " +
          chalk.bold("`nvm use`.")
      )
    );
    process.exit(1);
  }

  if (process.platform === "win32") {
    console.log(
      chalk.yellow(
        "Convex has preliminary support for development on Windows. Some functionality may be missing or broken. Please report issues at https://convex.dev/community. Read the docs for more information: https://docs.convex.dev/understanding/state#windows-development."
      )
    );
  }

  const program = new Command();
  program
    .name("convex")
    .usage("<command> [options]")
    .addCommand(login, { hidden: true })
    .addCommand(init, { hidden: true })
    .addCommand(reinit, { hidden: true })
    .addCommand(dev)
    .addCommand(deploy)
    .addCommand(deployments, { hidden: true })
    .addCommand(typecheck, { hidden: true })
    .addCommand(auth)
    .addCommand(convexImport)
    .addCommand(codegen)
    .addCommand(dashboard)
    .addCommand(docs)
    .addCommand(update)
    .addHelpCommand("help <command>", "Show help for given <command>")
    .version(version)
    // Hide version and help so they don't clutter
    // the list of commands.
    .configureHelp({ visibleOptions: () => [] })
    .showHelpAfterError();

  // Run the command and be sure to flush Sentry before exiting.
  try {
    await program.parseAsync(process.argv);
  } catch (e) {
    Sentry.captureException(e);
    process.exitCode = 1;
    throw e;
  } finally {
    await Sentry.close();
  }
  process.exit();
}
void main();
