import axios, { AxiosError, AxiosInstance, AxiosResponse, Method } from "axios";
import chalk from "chalk";
import inquirer from "inquirer";
import * as readline from "readline";
import path from "path";
import os from "os";
import { z } from "zod";

import type { ProjectConfig } from "./config.js";

import { Context, ErrorType, logError, logWarning } from "./context.js";
import { version } from "../../index.js";
import { Project } from "./api.js";

export const productionProvisionHost = "https://provision.convex.dev";
export const provisionHost =
  process.env.CONVEX_PROVISION_HOST || productionProvisionHost;
const BIG_BRAIN_URL = `${provisionHost}/api`;

/** Prompt for keyboard input with the given `query` string and return a promise
 * that resolves to the input. */
export function prompt(query: string) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve =>
    rl.question(query, answer => {
      rl.close();
      resolve(answer);
    })
  );
}

type ErrorData = {
  code: string;
  message: string;
};

/**
 * Handle an error from an axios request.
 *
 * TODO: Ideally this only takes in err: AxiosError, but currently
 * it's called more broadly.
 */
export async function logAndHandleAxiosError(
  ctx: Context,
  err: any
): Promise<never> {
  if (ctx.spinner) {
    // Fail the spinner so the console logs appear
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
      error_type = "invalid filesystem data";
    } else if (res.status === 401) {
      error_type = "fatal";
      msg = `${msg}\nAuthenticate with \`npx convex dev\``;
    } else if (res.status === 404) {
      error_type = "fatal";
      msg = `${msg}: ${res.config.url}`;
    }

    logError(ctx, chalk.red(msg));
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

async function checkErrorForDeprecation(
  ctx: Context,
  resp: AxiosResponse<ErrorData, any>
) {
  const headers = resp.headers;
  if (headers) {
    const deprecationState = headers["x-convex-deprecation-state"];
    const deprecationMessage = headers["x-convex-deprecation-message"];
    switch (deprecationState) {
      case undefined:
        break;
      case "Deprecated":
      case "UpgradeCritical":
        // This version is deprecated. Print a warning and crash.

        // Gotchas:
        // 1. We consider `UpgradeCritical` to be a fatal error in the CLI.
        // This enables us to deprecate the CLI before the web client.
        // 2. Don't use `logDeprecationWarning` because we should always print
        // why this we crashed (even if we printed a warning earlier).
        logError(ctx, chalk.red(deprecationMessage));
        return await ctx.crash(1, "fatal");
      case "Upgradable":
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
export function deprecationCheckWarning(
  ctx: Context,
  resp: AxiosResponse<any, any>
) {
  const headers = resp.headers;
  if (headers) {
    const deprecationState = headers["x-convex-deprecation-state"];
    const deprecationMessage = headers["x-convex-deprecation-message"];
    switch (deprecationState) {
      case undefined:
        break;
      case "Deprecated":
      case "UpgradeCritical":
        // This should never happen because such states are errors, not warnings.
        throw new Error(
          "Called deprecationCheckWarning on a fatal error. This is a bug."
        );
      case "Upgradable":
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
  const teams: Team[] = await bigBrainAPI(ctx, "GET", "teams");
  return teams.some(team => team.slug === teamSlug);
}

export async function validateOrSelectTeam(
  ctx: Context,
  teamSlug: string | null,
  promptMessage: string
): Promise<{ teamSlug: string; chosen: boolean }> {
  const teams: Team[] = await bigBrainAPI(ctx, "GET", "teams");
  if (teams.length === 0) {
    console.error(chalk.red("Error: No teams found"));
    throw new Error("No teams found");
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
    if (!teams.find(team => team.slug === teamSlug)) {
      console.error(
        chalk.red(
          `Error: Team ${teamSlug} not found, fix the --team option or remove it`
        )
      );
      await ctx.crash(1, "fatal");
    }
    return { teamSlug, chosen: false };
  }
}

export async function hasProject(
  ctx: Context,
  teamSlug: string,
  projectSlug: string
) {
  try {
    const projects: Project[] = await bigBrainAPIMaybeThrows(
      ctx,
      "GET",
      `/teams/${teamSlug}/projects`
    );
    return !!projects.find(project => project.slug === projectSlug);
  } catch (e) {
    return false;
  }
}

export async function hasProjects(ctx: Context) {
  return !!(await bigBrainAPI(ctx, "GET", `/has_projects`));
}

export async function validateOrSelectProject(
  ctx: Context,
  projectSlug: string | null,
  teamSlug: string,
  singleProjectPrompt: string,
  multiProjectPrompt: string
): Promise<string | null> {
  const projects: Project[] = await bigBrainAPI(
    ctx,
    "GET",
    `/teams/${teamSlug}/projects`
  );
  if (projects.length === 0) {
    console.error(chalk.red("Error: No projects found"));
    throw new Error("No projects found");
  }
  if (!projectSlug) {
    // Prompt the user to select project.
    switch (projects.length) {
      case 1: {
        const project = projects[0];
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
        return projects[0].slug;
      }
      default:
        return (
          await inquirer.prompt([
            {
              name: "project",
              message: multiProjectPrompt,
              type: "list",
              choices: projects.map((project: Project) => ({
                name: `${project.name} (${project.slug})`,
                value: project.slug,
              })),
            },
          ])
        ).project;
    }
  } else {
    // Validate the chosen project.
    if (!projects.find(project => project.slug === projectSlug)) {
      console.error(
        chalk.red(
          `Error: Project ${projectSlug} not found, fix the --project option or remove it`
        )
      );
      await ctx.crash(1, "fatal");
    }
    return projectSlug;
  }
}

class PackageJsonLoadError extends Error {}

/**
 * @param ctx
 * @returns a Record of dependency name to dependency version for dependencies
 * and devDependencies
 */
export async function loadPackageJson(
  ctx: Context
): Promise<Record<string, string>> {
  let packageJson;
  try {
    packageJson = ctx.fs.readUtf8File("package.json");
  } catch (err) {
    console.error(
      chalk.red(
        `Unable to read your package.json: ${err}. Make sure you're running this command from the root directory of a Convex app that contains the package.json`
      )
    );
    return await ctx.crash(1, "invalid filesystem data");
  }
  let obj;
  try {
    obj = JSON.parse(packageJson);
  } catch (err) {
    console.error(chalk.red(`Unable to parse package.json: ${err}`));
    return await ctx.crash(1, "invalid filesystem data", err);
  }
  if (typeof obj !== "object") {
    throw new PackageJsonLoadError(
      "Expected to parse an object from package.json"
    );
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
    console.error(
      chalk.red(
        `In order to ${cmd}, add \`convex\` to your package.json dependencies.`
      )
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
  projectConfig: ProjectConfig
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
    console.error(
      chalk.red(
        `Failed to parse global config in ${configPath} with error ${err}.`
      )
    );
    return null;
  }
}

export async function getAuthHeader(ctx: Context): Promise<string | null> {
  if (process.env.CONVEX_OVERRIDE_ACCESS_TOKEN) {
    return `Bearer ${process.env.CONVEX_OVERRIDE_ACCESS_TOKEN}`;
  }
  const globalConfig = await readGlobalConfig(ctx);
  if (globalConfig) {
    return `Bearer ${globalConfig.accessToken}`;
  }
  return null;
}

export async function bigBrainClient(ctx: Context): Promise<AxiosInstance> {
  const authHeader = await getAuthHeader(ctx);
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

export async function bigBrainAPI(
  ctx: Context,
  method: Method,
  url: string,
  data?: any
): Promise<any> {
  try {
    return await bigBrainAPIMaybeThrows(ctx, method, url, data);
  } catch (err) {
    return await logAndHandleAxiosError(ctx, err);
  }
}

export async function bigBrainAPIMaybeThrows(
  ctx: Context,
  method: Method,
  url: string,
  data?: any
): Promise<any> {
  const client = await bigBrainClient(ctx);
  const res = await client.request({ url, method, data });
  deprecationCheckWarning(ctx, res);
  return res.data;
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
  waitMs = 1000
) {
  let result = await fetch();
  while (!condition(result)) {
    await wait(waitMs);
    result = await fetch();
  }
  return result;
};

const wait = function (waitMs: number) {
  return new Promise(resolve => {
    setTimeout(resolve, waitMs);
  });
};

// We can eventually switch to something like `filesize` for i18n and
// more robust formatting, but let's keep our CLI bundle small for now.
export function formatSize(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${Math.floor(n / 1024)} KB`;
  }
  if (n < 1024 * 1024 * 1024) {
    return `${Math.floor(n / 1024 / 1024)} MB`;
  }
  return `${n} B`;
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
function findParentConfigs(ctx: Context): {
  parentPackageJson?: string;
  parentConvexJson?: string;
} {
  const parentPackageJson = findUp(ctx, "package.json");
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
  const { parentPackageJson, parentConvexJson } = findParentConfigs(ctx);
  if (!parentPackageJson) {
    console.error(
      "No package.json found. If you meant to create a new project, try"
    );
    console.error(`npx create-next-app@latest -e convex my-convex-app`);
    await ctx.crash(1);
  }
  if (parentPackageJson !== path.resolve("package.json")) {
    console.error("Run this command from the root directory of a project.");
    return await ctx.crash(1, "invalid filesystem data");
  }
  return !!parentConvexJson;
}
