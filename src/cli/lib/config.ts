import { AxiosError } from "axios";
import chalk from "chalk";
import equal from "deep-equal";
import { EOL } from "os";
import path from "path";
import {
  changeSpinner,
  Context,
  logError,
  logFailure,
  logFinishedStep,
  logMessage,
  showSpinner,
} from "../../bundler/context.js";
import {
  Bundle,
  bundle,
  bundleAuthConfig,
  entryPointsByEnvironment,
} from "../../bundler/index.js";
import { version } from "../version.js";
import { dashboardUrlForConfiguredDeployment } from "../dashboard.js";
import {
  deprecationCheckWarning,
  formatSize,
  functionsDir,
  getConfiguredDeployment,
  logAndHandleAxiosError,
  ErrorData,
  deploymentClient,
  loadPackageJson,
} from "./utils.js";
export { productionProvisionHost, provisionHost } from "./utils.js";

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
  node: {
    externalPackages: string[];
  };
  generateCommonJSApi: boolean;
  // deprecated
  project?: string;
  // deprecated
  team?: string;
  // deprecated
  prodUrl?: string;
  // deprecated
  authInfo?: AuthInfo[];
}

interface NodeDependency {
  name: string;
  version: string;
}

export interface Config {
  projectConfig: ProjectConfig;
  modules: Bundle[];
  nodeDependencies: NodeDependency[];
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
  if (typeof obj.node === "undefined") {
    obj.node = {
      externalPackages: [],
    };
  } else if (typeof obj.node.externalPackages === "undefined") {
    obj.node.externalPackages = [];
  } else if (
    !Array.isArray(obj.node.externalPackages) ||
    !obj.node.externalPackages.every((item: any) => typeof item === "string")
  ) {
    logError(
      ctx,
      "Expected `node.externalPackages` in `convex.json` to be an array of strings"
    );
    return await ctx.crash(1, "invalid filesystem data");
  }
  if (typeof obj.generateCommonJSApi === "undefined") {
    obj.generateCommonJSApi = false;
  } else if (typeof obj.generateCommonJSApi !== "boolean") {
    logError(
      ctx,
      "Expected `generateCommonJSApi` in `convex.json` to be true or false"
    );
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
    logError(
      ctx,
      chalk.red(
        `Error: both ${preferredLocation} and ${wrongLocation} files exist!`
      )
    );
    logFailure(ctx, `Consolidate these and remove ${wrongLocation}.`);
    return await ctx.crash(1, "invalid filesystem data");
  }
  if (!preferredLocationExists && wrongLocationExists) {
    logFailure(
      ctx,
      `Error: Please move ${wrongLocation} to the root of your project`
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
  if (!ctx.fs.exists("convex.json")) {
    // create-react-app bans imports from outside of src, so we can just
    // put the functions directory inside of src/ to work around this issue.
    const packages = await loadPackageJson(ctx);
    const isCreateReactApp = "react-scripts" in packages;
    return {
      projectConfig: {
        functions: isCreateReactApp
          ? `src/${DEFAULT_FUNCTIONS_PATH}`
          : DEFAULT_FUNCTIONS_PATH,
        node: {
          externalPackages: [],
        },
        generateCommonJSApi: false,
      },
      configPath: configName(),
    };
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
      logError(ctx, chalk.red(`Error: Parsing "${configPath}" failed`));
      logMessage(ctx, chalk.gray(err.toString()));
    } else {
      logFailure(
        ctx,
        `Error: Unable to read project config file "${configPath}"\n` +
          "  Are you running this command from the root directory of a Convex project? If so, run `npx convex dev` first."
      );
      if (err instanceof Error) {
        logError(ctx, chalk.red(err.message));
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
  logFailure(ctx, `Error: Parsing convex.json failed`);
  logMessage(ctx, chalk.gray(err.toString()));
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
): Promise<{
  config: Config;
  bundledModuleInfos: BundledModuleInfo[];
}> {
  const baseDir = functionsDir(configPath, projectConfig);
  // We bundle functions entry points separately since they execute on different
  // platforms.
  const entryPoints = await entryPointsByEnvironment(ctx, baseDir, verbose);
  // es-build prints errors to console which would clobber
  // our spinner.
  if (verbose) {
    showSpinner(ctx, "Bundling modules for Convex's runtime...");
  }
  const convexResult = await bundle(
    ctx,
    baseDir,
    entryPoints.isolate,
    true,
    "browser"
  );
  if (verbose) {
    logMessage(
      ctx,
      "Convex's runtime modules: ",
      convexResult.modules.map((m) => m.path)
    );
  }

  // Bundle node modules.
  if (verbose) {
    showSpinner(ctx, "Bundling modules for Node.js runtime...");
  }
  const nodeResult = await bundle(
    ctx,
    baseDir,
    entryPoints.node,
    true,
    "node",
    path.join("_deps", "node"),
    projectConfig.node.externalPackages
  );
  if (verbose) {
    logMessage(
      ctx,
      "Node.js runtime modules: ",
      nodeResult.modules.map((m) => m.path)
    );
    if (projectConfig.node.externalPackages.length > 0) {
      logMessage(
        ctx,
        "Node.js runtime external dependencies (to be installed on the server): ",
        [...nodeResult.externalDependencies.entries()].map(
          (a) => `${a[0]}: ${a[1]}`
        )
      );
    }
  }
  const modules = convexResult.modules;
  modules.push(...nodeResult.modules);
  modules.push(...(await bundleAuthConfig(ctx, baseDir)));

  const nodeDependencies: NodeDependency[] = [];
  for (const [moduleName, moduleVersion] of nodeResult.externalDependencies) {
    nodeDependencies.push({ name: moduleName, version: moduleVersion });
  }

  const bundledModuleInfos: BundledModuleInfo[] = Array.from(
    convexResult.bundledModuleNames.keys()
  ).map((moduleName) => {
    return {
      name: moduleName,
      platform: "convex",
    };
  });
  bundledModuleInfos.push(
    ...Array.from(nodeResult.bundledModuleNames.keys()).map(
      (moduleName): BundledModuleInfo => {
        return {
          name: moduleName,
          platform: "node",
        };
      }
    )
  );

  return {
    config: {
      projectConfig: projectConfig,
      modules: modules,
      nodeDependencies: nodeDependencies,
      // We're just using the version this CLI is running with for now.
      // This could be different than the version of `convex` the app runs with
      // if the CLI is installed globally.
      udfServerVersion: version,
    },
    bundledModuleInfos,
  };
}

/**
 * Read the config from `convex.json` and bundle all the modules.
 */
export async function readConfig(
  ctx: Context,
  verbose: boolean
): Promise<{
  config: Config;
  configPath: string;
  bundledModuleInfos: BundledModuleInfo[];
}> {
  const { projectConfig, configPath } = await readProjectConfig(ctx);
  const { config, bundledModuleInfos } = await configFromProjectConfig(
    ctx,
    projectConfig,
    configPath,
    verbose
  );
  return { config, configPath, bundledModuleInfos };
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
    if (config.authInfo.length > 0) {
      const providersStringLines = JSON.stringify(
        config.authInfo,
        null,
        2
      ).split(EOL);
      const indentedProvidersString = [providersStringLines[0]]
        .concat(providersStringLines.slice(1).map((line) => `  ${line}`))
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
    }
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
      logFailure(
        ctx,
        `Error: Unable to write project config file "${configPath}" in current directory\n` +
          "  Are you running this command from the root directory of a Convex project?"
      );
      return await ctx.crash(1, "invalid filesystem data", err);
    }
  } else if (deleteIfAllDefault && ctx.fs.exists(configPath)) {
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
  if (Array.isArray(stripped.authInfo) && stripped.authInfo.length === 0) {
    delete stripped.authInfo;
  }
  if (stripped.node.externalPackages.length === 0) {
    delete stripped.node.externalPackages;
  }
  if (stripped.generateCommonJSApi === false) {
    delete stripped.generateCommonJSApi;
  }
  // Remove "node" field if it has nothing nested under it
  if (Object.keys(stripped.node).length === 0) {
    delete stripped.node;
  }
  return stripped;
}

function filterWriteableConfig(projectConfig: any) {
  const writeable: any = { ...projectConfig };
  delete writeable.project;
  delete writeable.team;
  delete writeable.prodUrl;
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
  const client = deploymentClient(origin);
  try {
    const res = await client.post(
      "/api/get_config",
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
      // This field is not stored in the backend, which is ok since it is also
      // not used to diff configs.
      node: {
        externalPackages: [],
      },
      // This field is not stored in the backend, it only affects the client.
      generateCommonJSApi: false,
      project,
      team,
      prodUrl: origin,
    };
    return {
      projectConfig,
      modules: res.data.modules,
      // TODO(presley): Add this to diffConfig().
      nodeDependencies: res.data.nodeDependencies,
      udfServerVersion: res.data.udfServerVersion,
    };
  } catch (err) {
    logFailure(ctx, `Error: Unable to pull deployment config from ${origin}`);
    return await logAndHandleAxiosError(ctx, err);
  }
}

interface BundledModuleInfo {
  name: string;
  platform: "node" | "convex";
}

export function configJSON(
  config: Config,
  adminKey: string,
  schemaId?: string,
  pushMetrics?: PushMetrics,
  bundledModuleInfos?: BundledModuleInfo[]
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
    nodeDependencies: config.nodeDependencies,
    udfServerVersion: config.udfServerVersion,
    schemaId,
    adminKey,
    pushMetrics,
    bundledModuleInfos,
  };
}

// Time in seconds of various spans of time during a push.
export type PushMetrics = {
  typecheck: number;
  bundle: number;
  schemaPush: number;
  codePull: number;
  totalBeforePush: number;
};

/** Push configuration to the given remote origin. */
export async function pushConfig(
  ctx: Context,
  config: Config,
  adminKey: string,
  url: string,
  pushMetrics?: PushMetrics,
  schemaId?: string,
  bundledModuleInfos?: BundledModuleInfo[]
): Promise<void> {
  const serializedConfig = configJSON(
    config,
    adminKey,
    schemaId,
    pushMetrics,
    bundledModuleInfos
  );
  const client = deploymentClient(url);
  try {
    if (config.nodeDependencies.length > 0) {
      changeSpinner(
        ctx,
        "Installing external packages and deploying source code..."
      );
    } else {
      changeSpinner(ctx, "Analyzing and deploying source code...");
    }
    await client.post("/api/push_config", serializedConfig, {
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        "Convex-Client": `npm-cli-${version}`,
      },
    });
  } catch (error) {
    if (
      (error as AxiosError<ErrorData>).response?.data?.code ===
      "AuthConfigMissingEnvironmentVariable"
    ) {
      (error as any).wasExpected = true;
      // If `npx convex dev` is running using --url there might not be a configured deployment
      const configuredDeployment = await getConfiguredDeployment(ctx);
      if (configuredDeployment !== null) {
        const dashboardUrl = await dashboardUrlForConfiguredDeployment(
          ctx,
          configuredDeployment
        );
        logFailure(
          ctx,
          `Go to ${dashboardUrl}/settings to setup your environment variable.`
        );
      } else {
        logFailure(ctx, `Fix your auth.config.js.`);
      }
      logError(ctx, chalk.red((error as any).response.data.message));
      await ctx.crash(1, "invalid filesystem or env vars", error);
    }

    logFailure(ctx, "Error: Unable to push deployment config to " + url);
    return await logAndHandleAxiosError(ctx, error);
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
