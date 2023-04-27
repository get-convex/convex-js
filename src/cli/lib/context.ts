import { Filesystem, nodeFs } from "../../bundler";
import * as Sentry from "@sentry/node";
import chalk from "chalk";
import ora, { Ora } from "ora";

/**
 * How the error should be handled when running `npx convex dev`.
 *
 * "invalid filesystem data": The error was likely caused by a developer's local
 * file system (e.g. `tsc` fails due to a syntax error). The `convex dev`
 * command will then print out the error and wait for the file to change before
 * retrying.
 *
 * "transient": The error was some transient issue (e.g. a network
 * error). This will then cause a retry after an exponential backoff.
 *
 * "fatal": This error is truly permanent. Exit `npx convex dev` because the
 * developer will need to take a manual commandline action.
 */
export type ErrorType = "invalid filesystem data" | "transient" | "fatal";

export interface Context {
  fs: Filesystem;
  deprecationMessagePrinted: boolean;
  spinner: Ora | undefined;
  // Reports to Sentry and either throws FatalError or exits the process.
  // Does not print the error.
  crash(exitCode: number, errorType?: ErrorType, err?: any): Promise<never>;
}

export const oneoffContext: Context = {
  fs: nodeFs,
  deprecationMessagePrinted: false,
  spinner: undefined,
  async crash(exitCode: number, _errorType?: ErrorType, err?: any) {
    return await flushAndExit(exitCode, err);
  },
};

async function flushAndExit(exitCode: number, err?: any) {
  if (err) {
    Sentry.captureException(err);
  }
  await Sentry.close();
  // eslint-disable-next-line no-restricted-syntax
  return process.exit(exitCode);
}

// Handles clearing spinner so that it doesn't get messed up
export function logError(ctx: Context, message: string) {
  ctx.spinner?.clear();
  console.error(message);
}

// Handles clearing spinner so that it doesn't get messed up
export function logWarning(ctx: Context, message: string) {
  ctx.spinner?.clear();
  console.error(message);
}

// Handles clearing spinner so that it doesn't get messed up
export function logMessage(ctx: Context, ...logged: any) {
  ctx.spinner?.clear();
  console.log(...logged);
}

// Start a spinner.
// To change its message use changeSpinner.
// To print warnings/erros while it's running use logError or logWarning.
// To stop it due to an error use logFailure.
// To stop it due to success use logFinishedStep.
export function showSpinner(ctx: Context, message: string) {
  ctx.spinner?.stop();
  ctx.spinner = ora({
    text: message,
    stream: process.stdout,
  }).start();
}

export function changeSpinner(ctx: Context, message: string) {
  if (ctx.spinner) {
    ctx.spinner.text = message;
  } else {
    console.log(message);
  }
}

export function logFailure(ctx: Context, message: string) {
  if (ctx.spinner) {
    ctx.spinner.fail(message);
    ctx.spinner = undefined;
  } else {
    console.log(`${chalk.red(`✖`)} ${message}`);
  }
}

// Stops and removes spinner if one is active
export function logFinishedStep(ctx: Context, message: string) {
  if (ctx.spinner) {
    ctx.spinner.succeed(message);
    ctx.spinner = undefined;
  } else {
    console.log(`${chalk.green(`✔`)} ${message}`);
  }
}

export function stopSpinner(ctx: Context) {
  if (ctx.spinner) {
    ctx.spinner.stop();
    ctx.spinner = undefined;
  }
}

export function pauseSpinner(ctx: Context) {
  if (ctx.spinner) {
    ctx.spinner.stop();
  }
}

export function resumeSpinner(ctx: Context) {
  if (ctx.spinner) {
    ctx.spinner.start();
  }
}
