import axios, { AxiosError, AxiosInstance, AxiosResponse, Method } from "axios";
import chalk from "chalk";
import inquirer from "inquirer";
import os from "os";
import path from "path";
import * as readline from "readline";
import { z } from "zod";

import { ProjectConfig } from "./config.js";

import axiosRetry from "axios-retry";
import { spawn } from "child_process";
import { InvalidArgumentError } from "commander";
import fetchRetryFactory, { RequestInitRetryParams } from "fetch-retry";
import nodeFetch, { Headers as NodeFetchHeaders } from "node-fetch";
import {
  Context,
  ErrorType,
  logError,
  logFailure,
  logMessage,
  logWarning,
} from "../../bundler/context.js";
import { version } from "../version.js";
import { Project } from "./api.js";
import {
  getConfiguredDeploymentFromEnvVar,
  isPreviewDeployKey,
} from "./deployment.js";

// For Node.js 16 support
const fetch = globalThis.fetch || nodeFetch;
const retryingFetch = fetchRetryFactory(fetch);

export const productionProvisionHost = "https://provision.convex.dev";
export const provisionHost =
  process.env.CONVEX_PROVISION_HOST || productionProvisionHost;
const BIG_BRAIN_URL = `${provisionHost}/api/`;
export const CONVEX_DEPLOY_KEY_ENV_VAR_NAME = "CONVEX_DEPLOY_KEY";

export function parsePositiveInteger(value: string) {
  const parsedValue = parseInteger(value);
  if (parsedValue <= 0) {
    // eslint-disable-next-line no-restricted-syntax
    throw new InvalidArgumentError("Not a positive number.");
  }
  return parsedValue;
}

export function parseInteger(value: string) {
  const parsedValue = +value;
  if (isNaN(parsedValue)) {
    // eslint-disable-next-line no-restricted-syntax
    throw new InvalidArgumentError("Not a number.");
  }
  return parsedValue;
}

/** Prompt for keyboard input with the given `query` string and return a promise
 * that resolves to the input. */
export function prompt(query: string) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

export type ErrorData = {
  code: string;
  message: string;
};

/**
 * Error thrown on non-2XX reponse codes to make most `fetch()` error handling
 * follow a single code path.
 */
export class ThrowingFetchError extends Error {
  response: Response;
  serverErrorData?: ErrorData;

  constructor(
    msg: string,
    {
      code,
      message,
      response,
    }: { cause?: Error; code?: string; message?: string; response: Response },
  ) {
    if (code !== undefined && message !== undefined) {
      super(`${msg}: ${code}: ${message}`);
      this.serverErrorData = { code, message };
    } else {
      super(msg);
    }

    Object.setPrototypeOf(this, ThrowingFetchError.prototype);

    this.response = response;
  }

  public static async fromResponse(
    response: Response,
    msg?: string,
  ): Promise<ThrowingFetchError> {
    msg = `${msg ? `${msg} ` : ""}${response.status} ${response.statusText}`;
    let code, message;
    try {
      ({ code, message } = await response.json());
    } catch (e: unknown) {
      // Do nothing because the non-2XX response code is the primary error here.
    }
    return new ThrowingFetchError(msg, { code, message, response });
  }

  async handle(ctx: Context): Promise<never> {
    let error_type: ErrorType = "transient";
    await checkFetchErrorForDeprecation(ctx, this.response);

    let msg = this.message;

    if (this.response.status === 400) {
      error_type = "invalid filesystem or env vars";
    } else if (this.response.status === 401) {
      error_type = "fatal";
      msg = `${msg}\nAuthenticate with \`npx convex dev\``;
    } else if (this.response.status === 404) {
      error_type = "fatal";
      msg = `${msg}: ${this.response.url}`;
    }

    logError(ctx, chalk.red(msg.trim()));
    return await ctx.crash(1, error_type, this);
  }
}

/**
 * Thin wrapper around `fetch()` which throws a FetchDataError on non-2XX
 * responses which includes error code and message from the response JSON.
 * (Axios-style)
 *
 * It also accepts retry options from fetch-retry.
 */
export async function throwingFetch(
  resource: RequestInfo | URL,
  options: (RequestInit & RequestInitRetryParams) | undefined,
): Promise<Response> {
  const Headers = globalThis.Headers || NodeFetchHeaders;
  const headers = new Headers((options || {})["headers"]);
  if (options?.body) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }
  const response = await retryingFetch(resource, options);
  if (!response.ok) {
    // This error must always be handled manually.
    // eslint-disable-next-line no-restricted-syntax
    throw await ThrowingFetchError.fromResponse(
      response,
      `Error fetching ${options?.method ? options.method + " " : ""} ${
        typeof resource === "string"
          ? resource
          : "url" in resource
            ? resource.url
            : resource.toString()
      }`,
    );
  }
  return response;
}

/**
 * Handle an error a fetch error or non-2xx response.
 */
export async function logAndHandleFetchError(
  ctx: Context,
  err: unknown,
): Promise<never> {
  if (ctx.spinner) {
    // Fail the spinner so the stderr lines appear
    ctx.spinner.fail();
  }
  if (err instanceof ThrowingFetchError) {
    return await err.handle(ctx);
  } else {
    logError(ctx, chalk.red(err));
    return await ctx.crash(1, "transient", err);
  }
}

/**
 * Handle an error from an axios request.
 *
 * TODO: Ideally this only takes in err: AxiosError, but currently
 * it's called more broadly.
 */
export async function logAndHandleAxiosError(
  ctx: Context,
  err: any,
): Promise<never> {
  if (ctx.spinner) {
    // Fail the spinner so the stderr lines appear
    ctx.spinner.fail();
  }

  let error_type: ErrorType = "transient";
  if (err.response) {
    const res = (err as AxiosError<ErrorData>).response!;
    await checkErrorForDeprecation(ctx, res);

    let msg = `${res.status} ${res.statusText}`;
    if (res.data.code && res.data.message) {
      msg = `${msg}: ${res.data.code}: ${res.data.message}`;
    }

    if (res.status === 400) {
      error_type = "invalid filesystem or env vars";
    } else if (res.status === 401) {
      error_type = "fatal";
      msg = `${msg}\nAuthenticate with \`npx convex dev\``;
    } else if (res.status === 404) {
      error_type = "fatal";
      msg = `${msg}: ${res.config.url}`;
    }

    logError(ctx, chalk.red(msg.trim()));
  } else {
    logError(ctx, chalk.red(err));
  }
  return await ctx.crash(1, error_type, err);
}

function logDeprecationWarning(ctx: Context, deprecationMessage: string) {
  if (ctx.deprecationMessagePrinted) {
    return;
  }
  ctx.deprecationMessagePrinted = true;
  logWarning(ctx, chalk.yellow(deprecationMessage));
}

async function checkFetchErrorForDeprecation(ctx: Context, resp: Response) {
  const headers = resp.headers;
  if (headers) {
    const deprecationState = headers.get("x-convex-deprecation-state");
    const deprecationMessage = headers.get("x-convex-deprecation-message");
    switch (deprecationState) {
      case null:
        break;
      case "Deprecated":
        // This version is deprecated. Print a warning and crash.

        // Gotcha:
        // 1. Don't use `logDeprecationWarning` because we should always print
        // why this we crashed (even if we printed a warning earlier).
        logError(ctx, chalk.red(deprecationMessage));
        return await ctx.crash(1, "fatal");
      default:
        // The error included a deprecation warning. Print, but handle the
        // error normally (it was for another reason).
        logDeprecationWarning(
          ctx,
          deprecationMessage || "(no deprecation message included)",
        );
        break;
    }
  }
}

async function checkErrorForDeprecation(
  ctx: Context,
  resp: AxiosResponse<ErrorData, any>,
) {
  const headers = resp.headers;
  if (headers) {
    const deprecationState = headers["x-convex-deprecation-state"];
    const deprecationMessage = headers["x-convex-deprecation-message"];
    switch (deprecationState) {
      case undefined:
        break;
      case "Deprecated":
        // This version is deprecated. Print a warning and crash.

        // Gotcha:
        // 1. Don't use `logDeprecationWarning` because we should always print
        // why this we crashed (even if we printed a warning earlier).
        logError(ctx, chalk.red(deprecationMessage));
        return await ctx.crash(1, "fatal");
      default:
        // The error included a deprecation warning. Print, but handle the
        // error normally (it was for another reason).
        logDeprecationWarning(ctx, deprecationMessage);
        break;
    }
  }
}

/// Call this method after a successful API response to conditionally print the
/// "please upgrade" message.
export function fetchDeprecationCheckWarning(ctx: Context, resp: Response) {
  const headers = resp.headers;
  if (headers) {
    const deprecationState = headers.get("x-convex-deprecation-state");
    const deprecationMessage = headers.get("x-convex-deprecation-message");
    switch (deprecationState) {
      case null:
        break;
      case "Deprecated":
        // This should never happen because such states are errors, not warnings.
        // eslint-disable-next-line no-restricted-syntax
        throw new Error(
          "Called deprecationCheckWarning on a fatal error. This is a bug.",
        );
      default:
        logDeprecationWarning(
          ctx,
          deprecationMessage || "(no deprecation message included)",
        );
        break;
    }
  }
}

/// Call this method after a successful API response to conditionally print the
/// "please upgrade" message.
export function deprecationCheckWarning(
  ctx: Context,
  resp: AxiosResponse<any, any>,
) {
  const headers = resp.headers;
  if (headers) {
    const deprecationState = headers["x-convex-deprecation-state"];
    const deprecationMessage = headers["x-convex-deprecation-message"];
    switch (deprecationState) {
      case undefined:
        break;
      case "Deprecated":
        // This should never happen because such states are errors, not warnings.
        // eslint-disable-next-line no-restricted-syntax
        throw new Error(
          "Called deprecationCheckWarning on a fatal error. This is a bug.",
        );
      default:
        logDeprecationWarning(ctx, deprecationMessage);
        break;
    }
  }
}

type Team = {
  id: number;
  name: string;
  slug: string;
};

export async function hasTeam(ctx: Context, teamSlug: string) {
  const teams: Team[] = await bigBrainAPI({ ctx, method: "GET", url: "teams" });
  return teams.some((team) => team.slug === teamSlug);
}

export async function validateOrSelectTeam(
  ctx: Context,
  teamSlug: string | undefined,
  promptMessage: string,
): Promise<{ teamSlug: string; chosen: boolean }> {
  const teams: Team[] = await bigBrainAPI({ ctx, method: "GET", url: "teams" });
  if (teams.length === 0) {
    logFailure(ctx, chalk.red("Error: No teams found"));
    await ctx.crash(1, "fatal", "No teams found");
  }
  if (!teamSlug) {
    // Prompt the user to select if they belong to more than one team.
    switch (teams.length) {
      case 1:
        return { teamSlug: teams[0].slug, chosen: false };
      default:
        return {
          teamSlug: (
            await inquirer.prompt([
              {
                name: "teamSlug",
                message: promptMessage,
                type: "list",
                choices: teams.map((team: Team) => ({
                  name: `${team.name} (${team.slug})`,
                  value: team.slug,
                })),
              },
            ])
          ).teamSlug,
          chosen: true,
        };
    }
  } else {
    // Validate the chosen team.
    if (!teams.find((team) => team.slug === teamSlug)) {
      logFailure(
        ctx,
        `Error: Team ${teamSlug} not found, fix the --team option or remove it`,
      );
      await ctx.crash(1, "fatal");
    }
    return { teamSlug, chosen: false };
  }
}

export async function hasProject(
  ctx: Context,
  teamSlug: string,
  projectSlug: string,
) {
  try {
    const projects: Project[] = await bigBrainAPIMaybeThrows({
      ctx,
      method: "GET",
      url: `teams/${teamSlug}/projects`,
    });
    return !!projects.find((project) => project.slug === projectSlug);
  } catch (e) {
    return false;
  }
}

export async function hasProjects(ctx: Context) {
  return !!(await bigBrainAPI({ ctx, method: "GET", url: `has_projects` }));
}

export async function validateOrSelectProject(
  ctx: Context,
  projectSlug: string | undefined,
  teamSlug: string,
  singleProjectPrompt: string,
  multiProjectPrompt: string,
): Promise<string | null> {
  const projects: Project[] = await bigBrainAPI({
    ctx,
    method: "GET",
    url: `teams/${teamSlug}/projects`,
  });
  if (projects.length === 0) {
    // Unexpected error
    // eslint-disable-next-line no-restricted-syntax
    throw new Error("No projects found");
  }
  if (!projectSlug) {
    const nonDemoProjects = projects.filter((project) => !project.isDemo);
    if (nonDemoProjects.length === 0) {
      // Unexpected error
      // eslint-disable-next-line no-restricted-syntax
      throw new Error("No projects found");
    }
    // Prompt the user to select project.
    switch (nonDemoProjects.length) {
      case 1: {
        const project = nonDemoProjects[0];
        const confirmed = (
          await inquirer.prompt([
            {
              type: "confirm",
              name: "confirmed",
              message: `${singleProjectPrompt} ${project.name} (${project.slug})?`,
            },
          ])
        ).confirmed;

        if (!confirmed) {
          return null;
        }
        return nonDemoProjects[0].slug;
      }
      default:
        return (
          await inquirer.prompt([
            {
              name: "project",
              message: multiProjectPrompt,
              type: "search-list",
              choices: nonDemoProjects.map((project: Project) => ({
                name: `${project.name} (${project.slug})`,
                value: project.slug,
              })),
            },
          ])
        ).project;
    }
  } else {
    // Validate the chosen project.
    if (!projects.find((project) => project.slug === projectSlug)) {
      logFailure(
        ctx,
        `Error: Project ${projectSlug} not found, fix the --project option or remove it`,
      );
      await ctx.crash(1, "fatal");
    }
    return projectSlug;
  }
}

/**
 * @param ctx
 * @returns a Record of dependency name to dependency version for dependencies
 * and devDependencies
 */
export async function loadPackageJson(
  ctx: Context,
): Promise<Record<string, string>> {
  let packageJson;
  try {
    packageJson = ctx.fs.readUtf8File("package.json");
  } catch (err) {
    logFailure(
      ctx,
      `Unable to read your package.json: ${
        err as any
      }. Make sure you're running this command from the root directory of a Convex app that contains the package.json`,
    );
    return await ctx.crash(1, "invalid filesystem data");
  }
  let obj;
  try {
    obj = JSON.parse(packageJson);
  } catch (err) {
    logFailure(ctx, `Unable to parse package.json: ${err as any}`);
    return await ctx.crash(1, "invalid filesystem data", err);
  }
  if (typeof obj !== "object") {
    logError(ctx, "Expected to parse an object from package.json");
    return await ctx.crash(1, "invalid filesystem data");
  }
  const packages = {
    ...(obj.dependencies ?? {}),
    ...(obj.devDependencies ?? {}),
  };
  return packages;
}

export async function ensureHasConvexDependency(ctx: Context, cmd: string) {
  const packages = await loadPackageJson(ctx);
  const hasConvexDependency = "convex" in packages;
  if (!hasConvexDependency) {
    logFailure(
      ctx,
      `In order to ${cmd}, add \`convex\` to your package.json dependencies.`,
    );
    return await ctx.crash(1, "invalid filesystem data");
  }
}

/** Return a new array with elements of the passed in array sorted by a key lambda */
export const sorted = <T>(arr: T[], key: (el: T) => any): T[] => {
  const newArr = [...arr];
  const cmp = (a: T, b: T) => {
    if (key(a) < key(b)) return -1;
    if (key(a) > key(b)) return 1;
    return 0;
  };
  return newArr.sort(cmp);
};

export function functionsDir(
  configPath: string,
  projectConfig: ProjectConfig,
): string {
  return path.join(path.dirname(configPath), projectConfig.functions);
}

export function rootDirectory(): string {
  let dirName;
  // Use a different directory for config files generated for tests
  if (process.env.CONVEX_PROVISION_HOST) {
    const port = process.env.CONVEX_PROVISION_HOST.split(":")[2];
    if (port === undefined || port === "8050") {
      dirName = `.convex-test`;
    } else {
      dirName = `.convex-test-${port}`;
    }
  } else {
    dirName = ".convex";
  }
  return path.join(os.homedir(), dirName);
}
export function globalConfigPath(): string {
  return path.join(rootDirectory(), "config.json");
}

async function readGlobalConfig(ctx: Context): Promise<GlobalConfig | null> {
  const configPath = globalConfigPath();
  let configFile;
  try {
    configFile = ctx.fs.readUtf8File(configPath);
  } catch (err) {
    return null;
  }
  try {
    const schema = z.object({
      accessToken: z.string().min(1),
    });
    const config: GlobalConfig = schema.parse(JSON.parse(configFile));
    return config;
  } catch (err) {
    // Print an error an act as if the file does not exist.
    logError(
      ctx,
      chalk.red(
        `Failed to parse global config in ${configPath} with error ${
          err as any
        }.`,
      ),
    );
    return null;
  }
}

export function readAdminKeyFromEnvVar(): string | undefined {
  return process.env[CONVEX_DEPLOY_KEY_ENV_VAR_NAME] ?? undefined;
}

export async function getAuthHeaderForBigBrain(
  ctx: Context,
): Promise<string | null> {
  if (process.env.CONVEX_OVERRIDE_ACCESS_TOKEN) {
    return `Bearer ${process.env.CONVEX_OVERRIDE_ACCESS_TOKEN}`;
  }
  const globalConfig = await readGlobalConfig(ctx);
  if (globalConfig) {
    return `Bearer ${globalConfig.accessToken}`;
  }
  const adminKey = readAdminKeyFromEnvVar();
  if (adminKey !== undefined && isPreviewDeployKey(adminKey)) {
    return `Bearer ${adminKey}`;
  }
  return null;
}

export async function bigBrainFetch(ctx: Context): Promise<typeof fetch> {
  const authHeader = await getAuthHeaderForBigBrain(ctx);
  const bigBrainHeaders: Record<string, string> = authHeader
    ? {
        Authorization: authHeader,
        "Convex-Client": `npm-cli-${version}`,
      }
    : {
        "Convex-Client": `npm-cli-${version}`,
      };
  return (resource: RequestInfo | URL, options: RequestInit | undefined) => {
    const { headers: optionsHeaders, ...rest } = options || {};
    const headers = {
      ...bigBrainHeaders,
      ...(optionsHeaders || {}),
    };
    const opts = {
      retries: 6,
      retryDelay,
      headers,
      ...rest,
    };

    const url =
      resource instanceof URL
        ? resource.pathname
        : typeof resource === "string"
          ? new URL(resource, BIG_BRAIN_URL)
          : new URL(resource.url, BIG_BRAIN_URL);
    return throwingFetch(url, opts);
  };
}

export async function bigBrainClient(ctx: Context): Promise<AxiosInstance> {
  const authHeader = await getAuthHeaderForBigBrain(ctx);
  const headers: Record<string, string> = authHeader
    ? {
        Authorization: authHeader,
        "Convex-Client": `npm-cli-${version}`,
      }
    : {
        "Convex-Client": `npm-cli-${version}`,
      };
  return axios.create({
    headers,
    baseURL: BIG_BRAIN_URL,
  });
}

export async function bigBrainAPI({
  ctx,
  method,
  url,
  data,
}: {
  ctx: Context;
  method: Method;
  url: string;
  data?: any;
}): Promise<any> {
  const dataString =
    data === undefined
      ? undefined
      : typeof data === "string"
        ? data
        : JSON.stringify(data);
  try {
    return await bigBrainAPIMaybeThrows({
      ctx,
      method,
      url,
      data: dataString,
    });
  } catch (err: unknown) {
    return await logAndHandleFetchError(ctx, err);
  }
}

export async function bigBrainAPIMaybeThrows({
  ctx,
  method,
  url,
  data,
}: {
  ctx: Context;
  method: Method;
  url: string;
  data?: any;
}): Promise<any> {
  const fetch = await bigBrainFetch(ctx);
  const dataString =
    data === undefined
      ? method === "POST" || method === "post"
        ? JSON.stringify({})
        : undefined
      : typeof data === "string"
        ? data
        : JSON.stringify(data);
  const res = await fetch(url, {
    method,
    ...(dataString ? { body: dataString } : {}),
    headers:
      method === "POST" || method === "post"
        ? {
            "Content-Type": "application/json",
          }
        : {},
  });
  fetchDeprecationCheckWarning(ctx, res);
  if (res.status === 200) {
    return await res.json();
  }
}

export type GlobalConfig = {
  accessToken: string;
};

/**
 * Polls an arbitrary function until a condition is met.
 *
 * @param fetch Function performing a fetch, returning resulting data.
 * @param condition This function will terminate polling when it returns `true`.
 * @param waitMs How long to wait in between fetches.
 * @returns The resulting data from `fetch`.
 */
export const poll = async function <Result>(
  fetch: () => Promise<Result>,
  condition: (data: Result) => boolean,
  waitMs = 1000,
) {
  let result = await fetch();
  while (!condition(result)) {
    await wait(waitMs);
    result = await fetch();
  }
  return result;
};

const wait = function (waitMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, waitMs);
  });
};

export function waitForever() {
  // This never resolves
  return new Promise((_) => {
    // ignore
  });
}

// Returns a promise and a function that resolves the promise.
export function waitUntilCalled(): [Promise<unknown>, () => void] {
  let onCalled: (v: unknown) => void;
  const waitPromise = new Promise((resolve) => (onCalled = resolve));
  return [waitPromise, () => onCalled(null)];
}

// We can eventually switch to something like `filesize` for i18n and
// more robust formatting, but let's keep our CLI bundle small for now.
export function formatSize(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  if (n < 1024 * 1024 * 1024) {
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  const twoDigits = (n: number, unit: string) =>
    `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}${unit}`;

  if (ms < 1e-3) {
    return twoDigits(ms * 1e9, "ns");
  }
  if (ms < 1) {
    return twoDigits(ms * 1e3, "µs");
  }
  if (ms < 1e3) {
    return twoDigits(ms, "ms");
  }
  const s = ms / 1e3;
  if (s < 60) {
    return twoDigits(ms / 1e3, "s");
  }
  return twoDigits(s / 60, "m");
}

export function getCurrentTimeString() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

// We don't allow running commands in project subdirectories yet,
// but we can provide better errors if we look around.
export async function findParentConfigs(ctx: Context): Promise<{
  parentPackageJson: string;
  parentConvexJson?: string;
}> {
  const parentPackageJson = findUp(ctx, "package.json");
  if (!parentPackageJson) {
    logFailure(
      ctx,
      "No package.json found. To create a new project using Convex, see https://docs.convex.dev/home#quickstarts",
    );
    return await ctx.crash(1, "invalid filesystem data");
  }
  const candidateConvexJson =
    parentPackageJson &&
    path.join(path.dirname(parentPackageJson), "convex.json");
  const parentConvexJson =
    candidateConvexJson && ctx.fs.exists(candidateConvexJson)
      ? candidateConvexJson
      : undefined;
  return {
    parentPackageJson,
    parentConvexJson,
  };
}

/**
 * Finds a file in the current working directory or a parent.
 *
 * @returns The absolute path of the first file found or undefined.
 */
function findUp(ctx: Context, filename: string): string | undefined {
  let curDir = path.resolve(".");
  let parentDir = curDir;
  do {
    const candidate = path.join(curDir, filename);
    if (ctx.fs.exists(candidate)) {
      return candidate;
    }
    curDir = parentDir;
    parentDir = path.dirname(curDir);
  } while (parentDir !== curDir);
  return;
}

/**
 * Returns whether there's an existing project config. Throws
 * if this is not a valid directory for a project config.
 */
export async function isInExistingProject(ctx: Context) {
  const { parentPackageJson, parentConvexJson } = await findParentConfigs(ctx);
  if (parentPackageJson !== path.resolve("package.json")) {
    logFailure(ctx, "Run this command from the root directory of a project.");
    return await ctx.crash(1, "invalid filesystem data");
  }
  return !!parentConvexJson;
}

export async function getConfiguredDeploymentOrCrash(
  ctx: Context,
): Promise<string> {
  const configuredDeployment = await getConfiguredDeploymentName(ctx);
  if (configuredDeployment !== null) {
    return configuredDeployment;
  }
  logFailure(
    ctx,
    "No CONVEX_DEPLOYMENT set, run `npx convex dev` to configure a Convex project",
  );
  return await ctx.crash(1, "invalid filesystem data");
}

export async function getConfiguredDeploymentName(ctx: Context) {
  const { parentPackageJson } = await findParentConfigs(ctx);
  if (parentPackageJson !== path.resolve("package.json")) {
    logFailure(ctx, "Run this command from the root directory of a project.");
    return await ctx.crash(1, "invalid filesystem data");
  }
  return getConfiguredDeploymentFromEnvVar().name;
}

// `spawnAsync` is the async version of Node's `spawnSync` (and `spawn`).
//
// By default, this returns the produced `stdout` and `stderror` and
// an error if one was encountered (to mirror `spawnSync`).
//
// If `stdio` is set to `"inherit"`, pipes `stdout` and `stderror` (
// pausing the spinner if one is running) and rejects the promise
// on errors (to mirror `execFileSync`).
export function spawnAsync(
  ctx: Context,
  command: string,
  args: ReadonlyArray<string>,
): Promise<{
  stdout: string;
  stderr: string;
  status: null | number;
  error?: Error | undefined;
}>;
export function spawnAsync(
  ctx: Context,
  command: string,
  args: ReadonlyArray<string>,
  options: { stdio: "inherit" },
): Promise<void>;
export function spawnAsync(
  ctx: Context,
  command: string,
  args: ReadonlyArray<string>,
  options?: { stdio: "inherit" },
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";

    const pipeOutput = options?.stdio === "inherit";

    if (pipeOutput) {
      child.stdout.on("data", (text) =>
        logMessage(ctx, text.toString("utf-8").trimEnd()),
      );
      child.stderr.on("data", (text) =>
        logError(ctx, text.toString("utf-8").trimEnd()),
      );
    } else {
      child.stdout.on("data", (data) => {
        stdout += data.toString("utf-8");
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString("utf-8");
      });
    }

    const completionListener = (code: number | null) => {
      child.removeListener("error", errorListener);
      const result = pipeOutput
        ? { status: code }
        : { stdout, stderr, status: code };
      if (code !== 0) {
        const argumentString =
          args && args.length > 0 ? ` ${args.join(" ")}` : "";
        const error = new Error(
          `\`${command}${argumentString}\` exited with non-zero code: ${code}`,
        );
        if (pipeOutput) {
          reject({ ...result, error });
        } else {
          resolve({ ...result, error });
        }
      } else {
        resolve(result);
      }
    };

    const errorListener = (error: Error) => {
      child.removeListener("exit", completionListener);
      child.removeListener("close", completionListener);
      if (pipeOutput) {
        reject({ error, status: null });
      } else {
        resolve({ error, status: null });
      }
    };

    if (pipeOutput) {
      child.once("exit", completionListener);
    } else {
      child.once("close", completionListener);
    }
    child.once("error", errorListener);
  });
}

const IDEMPOTENT_METHODS = ["GET", "HEAD", "PUT", "DELETE", "OPTIONS", "TRACE"];

function retryDelay(
  attempt: number,
  _error: Error | null,
  _response: Response | null,
): number {
  // immediate, 1s delay, 2s delay, 4s delay, etc.
  const delay = attempt === 0 ? 1 : 2 ** (attempt - 1) * 1000;
  const randomSum = delay * 0.2 * Math.random();
  return delay + randomSum;
}

export function deploymentFetch(
  deploymentUrl: string,
  onError?: (err: any) => void,
): typeof throwingFetch {
  return (resource: RequestInfo | URL, options: RequestInit | undefined) => {
    const url =
      resource instanceof URL
        ? resource.pathname
        : typeof resource === "string"
          ? new URL(resource, deploymentUrl)
          : new URL(resource.url, deploymentUrl);
    const func = throwingFetch(url, {
      retries: 6,
      retryDelay,
      retryOn: function (
        _attempt: number,
        error: Error | null,
        response: Response | null,
      ) {
        if (onError) {
          onError(error);
        }

        // Retry on network errors.
        if (error) {
          // TODO filter out all SSL errors
          // https://github.com/nodejs/node/blob/8a41d9b636be86350cd32847c3f89d327c4f6ff7/src/crypto/crypto_common.cc#L218-L245
          return true;
        }
        // Retry on 404s since these can sometimes happen with newly created
        // deployments for POSTs.
        if (response?.status === 404) {
          return true;
        }

        const method = options?.method?.toUpperCase();
        // Whatever the error code it doesn't hurt to retry idempotent requests.
        if (
          response &&
          !response.ok &&
          method &&
          IDEMPOTENT_METHODS.includes(method)
        ) {
          // ...but it's a bit annoying to wait for things we know won't succced
          if (
            [
              400, // Bad Request
              401, // Unauthorized
              402, // PaymentRequired
              403, // Forbidden
              405, // Method Not Allowed
              406, // Not Acceptable
              412, // Precondition Failed
              413, // Payload Too Large
              414, // URI Too Long
              415, // Unsupported Media Type
              416, // Range Not Satisfiable
            ].includes(response.status)
          ) {
            return false;
          }
          return true;
        }

        return false;
      },
      ...options,
    });
    return func;
  };
}

export function deploymentClient(
  deploymentURL: string,
  onError?: (err: any) => void,
) {
  const client = axios.create({
    baseURL: deploymentURL,
  });
  axiosRetry(client, {
    retries: 6,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
      if (onError) {
        onError(error);
      }
      // Retry on 404s since these can sometimes happen with newly created deployments.
      // Also retry on the default conditions.
      return (
        error.response?.status === 404 ||
        axiosRetry.isNetworkOrIdempotentRequestError(error)
      );
    },
  });
  return client;
}
