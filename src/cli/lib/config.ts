import chalk from "chalk";
import axios from "axios";
import equal from "deep-equal";
import path from "path";
import {
  Bundle,
  bundle,
  bundleAuthConfig,
  entryPointsByEnvironment,
} from "../../bundler/index.js";
import { version } from "../../index.js";
import axiosRetry from "axios-retry";
import {
  deprecationCheckWarning,
  formatSize,
  functionsDir,
  logAndHandleAxiosError,
  shouldUseNewFlow,
} from "./utils.js";
export { provisionHost, productionProvisionHost } from "./utils.js";
import {
  Context,
  logError,
  logFailure,
  logFinishedStep,
  logMessage,
} from "../../bundler/context.js";
import { EOL } from "os";

/** Type representing auth configuration. */
export interface AuthInfo {
  // Provider-specific application identifier. Corresponds to the `aud` field in an OIDC token.
  applicationID: string;
  // Domain used for authentication. Corresponds to the `iss` field in an OIDC token.
  domain: string;
}

/** Type representing Convex project configuration. */
export interface ProjectConfig {
  functions: string;
  // deprecated
  project?: string;
  // deprecated
  team?: string;
  // deprecated
  prodUrl?: string;
  // deprecated
  authInfo?: AuthInfo[];
}

export interface Config {
  projectConfig: ProjectConfig;
  modules: Bundle[];
  schemaId?: string;
  udfServerVersion?: string;
  authConfig?: Bundle;
}

const DEFAULT_FUNCTIONS_PATH = "convex/";

/** Check if object is of AuthInfo type. */
function isAuthInfo(object: any): object is AuthInfo {
  return (
    "applicationID" in object &&
    typeof object.applicationID === "string" &&
    "domain" in object &&
    typeof object.domain === "string"
  );
}

function isAuthInfos(object: any): object is AuthInfo[] {
  return Array.isArray(object) && object.every((item: any) => isAuthInfo(item));
}

/** Error parsing ProjectConfig representation. */
class ParseError extends Error {}

/** Parse object to ProjectConfig. */
export async function parseProjectConfig(
  ctx: Context,
  obj: any
): Promise<ProjectConfig> {
  if (typeof obj !== "object") {
    logError(ctx, "Expected `convex.json` to contain an object");
    return await ctx.crash(1, "invalid filesystem data");
  }
  if (typeof obj.functions === "undefined") {
    obj.functions = DEFAULT_FUNCTIONS_PATH;
  } else if (typeof obj.functions !== "string") {
    logError(ctx, "Expected `functions` in `convex.json` to be a string");
    return await ctx.crash(1, "invalid filesystem data");
  }

  // Allow the `authInfo` key to be omitted, treating it as an empty list of providers.
  if (obj.authInfo !== undefined) {
    if (!isAuthInfos(obj.authInfo)) {
      logError(
        ctx,
        "Expected `authInfo` in `convex.json` to be of type AuthInfo[]"
      );
      return await ctx.crash(1, "invalid filesystem data");
    }
  }

  // Important! We return the object itself (not a new object) because
  // we want to ensure that fields we're unaware of are "passed through".
  // It's possible that this is an old client and the server knows about new
  // fields that we don't.
  return obj;
}

// Parse a deployment config returned by the backend, picking out
// the fields we care about.
function parseBackendConfig(obj: any): {
  functions: string;
  authInfo?: AuthInfo[];
} {
  if (typeof obj !== "object") {
    // Unexpected error
    // eslint-disable-next-line no-restricted-syntax
    throw new ParseError("Expected an object");
  }
  const { functions, authInfo } = obj;
  if (typeof functions !== "string") {
    // Unexpected error
    // eslint-disable-next-line no-restricted-syntax
    throw new ParseError("Expected functions to be a string");
  }

  // Allow the `authInfo` key to be omitted
  if ((authInfo ?? null) !== null && !isAuthInfos(authInfo)) {
    // Unexpected error
    // eslint-disable-next-line no-restricted-syntax
    throw new ParseError("Expected authInfo to be type AuthInfo[]");
  }

  return {
    functions,
    ...((authInfo ?? null) !== null ? { authInfo: authInfo } : {}),
  };
}

export function configName(): string {
  return "convex.json";
}

export async function configFilepath(ctx: Context): Promise<string> {
  const configFn = configName();
  // We used to allow src/convex.json, but no longer (as of 10/7/2022).
  // Leave an error message around to help people out. We can remove this
  // error message after a couple months.
  const preferredLocation = configFn;
  const wrongLocation = path.join("src", configFn);

  // Allow either location, but not both.
  const preferredLocationExists = ctx.fs.exists(preferredLocation);
  const wrongLocationExists = ctx.fs.exists(wrongLocation);
  if (preferredLocationExists && wrongLocationExists) {
    console.error(
      chalk.red(
        `Error: both ${preferredLocation} and ${wrongLocation} files exist!`
      )
    );
    console.error(`Consolidate these and remove ${wrongLocation}.`);
    return await ctx.crash(1, "invalid filesystem data");
  }
  if (!preferredLocationExists && wrongLocationExists) {
    console.error(
      chalk.red(
        `Error: Please move ${wrongLocation} to the root of your project`
      )
    );
    return await ctx.crash(1, "invalid filesystem data");
  }

  return preferredLocation;
}

export async function getFunctionsDirectoryPath(ctx: Context): Promise<string> {
  const { projectConfig, configPath } = await readProjectConfig(ctx);
  return functionsDir(configPath, projectConfig);
}

/** Read configuration from a local `convex.json` file. */
export async function readProjectConfig(ctx: Context): Promise<{
  projectConfig: ProjectConfig;
  configPath: string;
}> {
  if (shouldUseNewFlow()) {
    if (!ctx.fs.exists("convex.json")) {
      return {
        projectConfig: { functions: DEFAULT_FUNCTIONS_PATH },
        configPath: configName(),
      };
    }
  }
  let projectConfig;
  const configPath = await configFilepath(ctx);
  try {
    projectConfig = await parseProjectConfig(
      ctx,
      JSON.parse(ctx.fs.readUtf8File(configPath))
    );
  } catch (err) {
    if (err instanceof ParseError || err instanceof SyntaxError) {
      console.error(chalk.red(`Error: Parsing "${configPath}" failed`));
      console.error(chalk.gray(err.toString()));
    } else {
      console.error(
        chalk.red(`Error: Unable to read project config file "${configPath}"`)
      );
      console.error(
        "Are you running this command from the root directory of a Convex project? If so, run `npx convex dev` first."
      );
      if (err instanceof Error) {
        console.error(chalk.gray(err.message));
      }
    }
    return await ctx.crash(1, "invalid filesystem data", err);
  }
  return {
    projectConfig,
    configPath,
  };
}

export async function enforceDeprecatedConfigField(
  ctx: Context,
  config: ProjectConfig,
  field: "team" | "project" | "prodUrl"
): Promise<string> {
  const value = config[field];
  if (typeof value === "string") {
    return value;
  }
  const err = new ParseError(`Expected ${field} to be a string`);
  console.error(chalk.red(`Error: Parsing convex.json failed`));
  console.error(chalk.gray(err.toString()));
  return await ctx.crash(1, "invalid filesystem data", err);
}

/**
 * Given an {@link ProjectConfig}, add in the bundled modules to produce the
 * complete config.
 */
export async function configFromProjectConfig(
  ctx: Context,
  projectConfig: ProjectConfig,
  configPath: string,
  verbose: boolean
): Promise<Config> {
  const baseDir = functionsDir(configPath, projectConfig);
  // We bundle functions entry points separately since they execute on different
  // platforms.
  const entryPoints = await entryPointsByEnvironment(ctx, baseDir, verbose);
  // es-build prints errors to console which would clobber
  // our spinner.
  const modules = await bundle(
    ctx,
    baseDir,
    entryPoints.isolate,
    true,
    "browser"
  );
  if (verbose) {
    logMessage(
      ctx,
      "Queries and mutations modules: ",
      modules.map(m => m.path)
    );
  }

  // Bundle node modules.
  const nodeModules = await bundle(
    ctx,
    baseDir,
    entryPoints.node,
    true,
    "node",
    path.join("_deps", "node")
  );
  if (verbose) {
    logMessage(
      ctx,
      "Node modules: ",
      nodeModules.map(m => m.path)
    );
  }
  modules.push(...nodeModules);
  modules.push(...(await bundleAuthConfig(ctx, baseDir)));

  return {
    projectConfig: projectConfig,
    modules: modules,
    // We're just using the version this CLI is running with for now.
    // This could be different than the version of `convex` the app runs with
    // if the CLI is installed globally.
    udfServerVersion: version,
  };
}

/**
 * Read the config from `convex.json` and bundle all the modules.
 */
export async function readConfig(
  ctx: Context,
  verbose: boolean
): Promise<{ config: Config; configPath: string }> {
  const { projectConfig, configPath } = await readProjectConfig(ctx);
  const config = await configFromProjectConfig(
    ctx,
    projectConfig,
    configPath,
    verbose
  );
  return { config, configPath };
}

export async function upgradeOldAuthInfoToAuthConfig(
  ctx: Context,
  config: ProjectConfig,
  functionsPath: string
) {
  if (config.authInfo !== undefined) {
    const authConfigPath = path.resolve(functionsPath, "auth.config.js");
    const authConfigRelativePath = path.join(
      config.functions,
      "auth.config.js"
    );
    if (ctx.fs.exists(authConfigPath)) {
      logFailure(
        ctx,
        `Cannot set auth config in both \`${authConfigRelativePath}\` and convex.json,` +
          ` remove it from convex.json`
      );
      await ctx.crash(1, "invalid filesystem data");
    }
    const providersStringLines = JSON.stringify(config.authInfo, null, 2).split(
      EOL
    );
    const indentedProvidersString = [providersStringLines[0]]
      .concat(providersStringLines.slice(1).map(line => `  ${line}`))
      .join(EOL);
    ctx.fs.writeUtf8File(
      authConfigPath,
      `\
export default {
  providers: ${indentedProvidersString},
};`
    );
    logMessage(
      ctx,
      chalk.yellowBright(
        `Moved auth config from config.json to \`${authConfigRelativePath}\``
      )
    );
    delete config.authInfo;
  }
  return config;
}

/** Write the config to `convex.json` in the current working directory. */
export async function writeProjectConfig(
  ctx: Context,
  projectConfig: ProjectConfig,
  { deleteIfAllDefault }: { deleteIfAllDefault: boolean } = {
    deleteIfAllDefault: false,
  }
) {
  const configPath = await configFilepath(ctx);
  const strippedConfig = filterWriteableConfig(stripDefaults(projectConfig));
  if (Object.keys(strippedConfig).length > 0) {
    try {
      const contents = JSON.stringify(strippedConfig, undefined, 2) + "\n";
      ctx.fs.writeUtf8File(configPath, contents, 0o644);
    } catch (err) {
      console.error(
        chalk.red(
          `Error: Unable to write project config file "${configPath}" in current directory`
        )
      );
      console.error(
        "Are you running this command from the root directory of a Convex project?"
      );
      return await ctx.crash(1, "invalid filesystem data", err);
    }
  } else if (deleteIfAllDefault) {
    ctx.fs.unlink(configPath);
    logMessage(
      ctx,
      chalk.yellowBright(
        `Deleted ${configPath} since it completely matched defaults`
      )
    );
  }
  ctx.fs.mkdir(functionsDir(configPath, projectConfig), {
    allowExisting: true,
  });
}

function stripDefaults(projectConfig: ProjectConfig): any {
  const stripped: any = { ...projectConfig };
  if (stripped.functions === DEFAULT_FUNCTIONS_PATH) {
    delete stripped.functions;
  }
  if (shouldUseNewFlow()) {
    if (Array.isArray(stripped.authInfo) && stripped.authInfo.length === 0) {
      delete stripped.authInfo;
    }
  }
  return stripped;
}

function filterWriteableConfig(projectConfig: any) {
  const writeable: any = { ...projectConfig };
  if (shouldUseNewFlow()) {
    delete writeable.project;
    delete writeable.team;
    delete writeable.prodUrl;
  }
  return writeable;
}

export function removedExistingConfig(
  ctx: Context,
  configPath: string,
  options: { allowExistingConfig?: boolean }
) {
  if (!options.allowExistingConfig) {
    return false;
  }
  ctx.fs.rm(configPath);
  logFinishedStep(ctx, `Removed existing ${configPath}`);
  return true;
}

/** Pull configuration from the given remote origin. */
export async function pullConfig(
  ctx: Context,
  project: string | undefined,
  team: string | undefined,
  origin: string,
  adminKey: string
): Promise<Config> {
  const client = axios.create();
  axiosRetry(client, {
    retries: 4,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: error => {
      return error.response?.status === 404 || false;
    },
  });
  try {
    const res = await client.post(
      `${origin}/api/get_config`,
      { version, adminKey },
      {
        maxContentLength: Infinity,
        headers: {
          "Convex-Client": `npm-cli-${version}`,
        },
      }
    );
    deprecationCheckWarning(ctx, res);
    const backendConfig = parseBackendConfig(res.data.config);
    const projectConfig = {
      ...backendConfig,
      project,
      team,
      prodUrl: origin,
    };
    return {
      projectConfig,
      modules: res.data.modules,
      udfServerVersion: res.data.udfServerVersion,
    };
  } catch (err) {
    logFailure(ctx, `Error: Unable to pull deployment config from ${origin}`);
    return await logAndHandleAxiosError(ctx, err);
  }
}

export function configJSON(
  config: Config,
  adminKey: string,
  schemaId?: string
) {
  // Override origin with the url
  const projectConfig = {
    projectSlug: config.projectConfig.project,
    teamSlug: config.projectConfig.team,
    functions: config.projectConfig.functions,
    authInfo: config.projectConfig.authInfo,
  };
  return {
    config: projectConfig,
    modules: config.modules,
    udfServerVersion: config.udfServerVersion,
    schemaId,
    adminKey,
  };
}

/** Push configuration to the given remote origin. */
export async function pushConfig(
  ctx: Context,
  config: Config,
  adminKey: string,
  url: string,
  schemaId?: string
): Promise<void> {
  const serializedConfig = configJSON(config, adminKey, schemaId);

  try {
    await axios.post(`${url}/api/push_config`, serializedConfig, {
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        "Convex-Client": `npm-cli-${version}`,
      },
    });
  } catch (err) {
    logFailure(ctx, "Error: Unable to push deployment config to " + url);
    return await logAndHandleAxiosError(ctx, err);
  }
}

type Files = { source: string; filename: string }[];

export type CodegenResponse =
  | {
      success: true;
      files: Files;
    }
  | {
      success: false;
      error: string;
    };

function renderModule(module: Bundle): string {
  const sourceMapSize = formatSize(module.sourceMap?.length ?? 0);
  return (
    module.path +
    ` (${formatSize(module.source.length)}, source map ${sourceMapSize})`
  );
}

function compareModules(oldModules: Bundle[], newModules: Bundle[]): string {
  let diff = "";

  const droppedModules = [];
  for (const oldModule of oldModules) {
    let matches = false;
    for (const newModule of newModules) {
      if (
        oldModule.path === newModule.path &&
        oldModule.source === newModule.source &&
        oldModule.sourceMap === newModule.sourceMap
      ) {
        matches = true;
        break;
      }
    }
    if (!matches) {
      droppedModules.push(oldModule);
    }
  }
  if (droppedModules.length > 0) {
    diff += "Delete the following modules:\n";
    for (const module of droppedModules) {
      diff += "[-] " + renderModule(module) + "\n";
    }
  }

  const addedModules = [];
  for (const newModule of newModules) {
    let matches = false;
    for (const oldModule of oldModules) {
      if (
        oldModule.path === newModule.path &&
        oldModule.source === newModule.source &&
        oldModule.sourceMap === newModule.sourceMap
      ) {
        matches = true;
        break;
      }
    }
    if (!matches) {
      addedModules.push(newModule);
    }
  }
  if (addedModules.length > 0) {
    diff += "Add the following modules:\n";
    for (const module of addedModules) {
      diff += "[+] " + renderModule(module) + "\n";
    }
  }

  return diff;
}

/** Generate a human-readable diff between the two configs. */
export function diffConfig(oldConfig: Config, newConfig: Config): string {
  let diff = compareModules(oldConfig.modules, newConfig.modules);

  const droppedAuth = [];
  if (
    oldConfig.projectConfig.authInfo !== undefined &&
    newConfig.projectConfig.authInfo !== undefined
  ) {
    for (const oldAuth of oldConfig.projectConfig.authInfo) {
      let matches = false;
      for (const newAuth of newConfig.projectConfig.authInfo) {
        if (equal(oldAuth, newAuth)) {
          matches = true;
          break;
        }
      }
      if (!matches) {
        droppedAuth.push(oldAuth);
      }
    }
    if (droppedAuth.length > 0) {
      diff += "Remove the following auth providers:\n";
      for (const authInfo of droppedAuth) {
        diff += "[-] " + JSON.stringify(authInfo) + "\n";
      }
    }

    const addedAuth = [];
    for (const newAuth of newConfig.projectConfig.authInfo) {
      let matches = false;
      for (const oldAuth of oldConfig.projectConfig.authInfo) {
        if (equal(newAuth, oldAuth)) {
          matches = true;
          break;
        }
      }
      if (!matches) {
        addedAuth.push(newAuth);
      }
    }
    if (addedAuth.length > 0) {
      diff += "Add the following auth providers:\n";
      for (const auth of addedAuth) {
        diff += "[+] " + JSON.stringify(auth) + "\n";
      }
    }
  } else if (
    (oldConfig.projectConfig.authInfo !== undefined) !==
    (newConfig.projectConfig.authInfo !== undefined)
  ) {
    diff += "Moved auth config into auth.config.js\n";
  }

  let versionMessage = "";
  const matches = oldConfig.udfServerVersion === newConfig.udfServerVersion;
  if (oldConfig.udfServerVersion && (!newConfig.udfServerVersion || !matches)) {
    versionMessage += `[-] ${oldConfig.udfServerVersion}\n`;
  }
  if (newConfig.udfServerVersion && (!oldConfig.udfServerVersion || !matches)) {
    versionMessage += `[+] ${newConfig.udfServerVersion}\n`;
  }
  if (versionMessage) {
    diff += "Change the server's function version:\n";
    diff += versionMessage;
  }

  return diff;
}
