import { PluginBuild } from "esbuild";
import type { Plugin } from "esbuild";
import { Context } from "./context";
import path from "path";

import { findUp } from "find-up";

/**
 * Mimics Node.js node_modules resolution. Ideally we would be able to
 * reuse the logic in esbuild but calling build.resolve() from onResolve()
 * results in infinite recursion. See https://esbuild.github.io/plugins/#resolve
 */
async function findNodeModuleDirectories(
  resolveDir: string
): Promise<string[]> {
  let nodeModulesPath: string | undefined;

  const allPaths: string[] = [];
  while (
    (nodeModulesPath = await findUp("node_modules", {
      type: "directory",
      cwd: resolveDir,
    }))
  ) {
    allPaths.push(nodeModulesPath);
    resolveDir = path.dirname(path.dirname(nodeModulesPath));
  }

  return allPaths;
}

function getModule(
  importPath: string
): { name: string; dirName: string } | undefined {
  if (importPath.startsWith(".")) {
    // Relative import.
    return undefined;
  }

  // In case of scoped package
  if (importPath.startsWith("@")) {
    const split = importPath.split("/");
    return {
      name: `${split[0]}/${split[1]}`,
      dirName: path.join(split[0], split[1]),
    };
  } else {
    const moduleName = importPath.split("/")[0];
    return {
      name: moduleName,
      dirName: moduleName,
    };
  }
}

// Inspired by https://www.npmjs.com/package/esbuild-node-externals.
export function createExternalPlugin(
  ctx: Context,
  externalNodeModules: string[]
): {
  plugin: Plugin;
  externalModulePaths: Map<string, string[]>;
} {
  const externalModulePaths = new Map<string, string[]>();

  return {
    plugin: {
      name: "convex-node-externals",
      setup(build: PluginBuild) {
        // On every module resolved, we check if the module name should be an external
        build.onResolve({ namespace: "file", filter: /.*/ }, async args => {
          const module = getModule(args.path);

          // Fallback if this does not look like node module import. Also, we
          // always bundle in Convex.
          if (module === undefined || module.name === "convex") {
            return null;
          }

          // Bundle if not in the allow list.
          if (
            !externalNodeModules.includes(module.name) &&
            !externalNodeModules.includes("*")
          ) {
            return null;
          }

          for (const dir of await findNodeModuleDirectories(args.resolveDir)) {
            // Note that module.name and module.dirName might differ on Windows.
            const maybePath = path.join(dir, module.dirName);
            // TODO(presley): Make this async.
            if (ctx.fs.exists(maybePath)) {
              let version: string | undefined = undefined;
              try {
                version = await findExactVersion(ctx, module.name, maybePath);
                if (version === undefined) {
                  // If version is undefined, we bundle instead of marking as
                  // external dependency.
                  return null;
                }
              } catch (e: any) {
                // Don't throw an error here and instead mark as external
                // dependency and continue. Throwing errors from the plugin
                // doesn't result in clean errors, you can also get multiple ones.
              }
              const paths = externalModulePaths.get(module.name);
              if (paths !== undefined) {
                if (!paths.includes(maybePath)) {
                  paths.push(maybePath);
                }
              } else {
                externalModulePaths.set(module.name, [maybePath]);
              }

              return { path: args.path, external: true };
            }
          }

          return null;
        });
      },
    },
    externalModulePaths: externalModulePaths,
  };
}

export async function findExactVersion(
  ctx: Context,
  moduleName: string,
  modulePath: string
): Promise<string | undefined> {
  let nodeModulesPath = modulePath;
  for (const _ of moduleName.split("/")) {
    nodeModulesPath = path.dirname(nodeModulesPath);
  }
  const packageJsonPath = path.join(nodeModulesPath, "../package.json");
  if (!ctx.fs.exists(packageJsonPath)) {
    // eslint-disable-next-line no-restricted-syntax
    throw new Error(`${packageJsonPath} is missing`);
  }
  const dependencies = new Map();
  try {
    // TODO(presley): Cache this, so we don't parse multiple times.
    const packageJsonString = ctx.fs.readUtf8File(packageJsonPath);
    const packageJson = JSON.parse(packageJsonString);
    for (const key of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      for (const [packageName, packageVersion] of Object.entries(
        packageJson[key] ?? {}
      )) {
        if (!dependencies.has(packageName)) {
          dependencies.set(packageName, packageVersion);
        }
      }
    }
  } catch (e: any) {
    // eslint-disable-next-line no-restricted-syntax
    throw new Error(`Failed to parse ${packageJsonPath}: ${e.toString()}`);
  }
  const packageJsonVersion = dependencies.get(moduleName);
  if (packageJsonVersion === undefined) {
    // eslint-disable-next-line no-restricted-syntax
    throw new Error(`${moduleName} is missing from ${packageJsonPath}`);
  }
  if (
    packageJsonVersion.startsWith("file://") ||
    packageJsonVersion.startsWith("git+file://")
  ) {
    // Bundle instead of installing on the server.
    return undefined;
  }
  if (
    packageJsonVersion.startsWith("http://") ||
    packageJsonVersion.startsWith("https://") ||
    packageJsonVersion.startsWith("git://") ||
    packageJsonVersion.startsWith("git+ssh://") ||
    packageJsonVersion.startsWith("git+http://") ||
    packageJsonVersion.startsWith("git+https://")
  ) {
    // Assume the version in package.json can be installed. Note there are
    // corner cases like http://127.0.0.1/... where this might not be true.
    return packageJsonVersion;
  }
  // We now pick the exact version installed locally. We might switch this for a
  // lock file in the future.
  // TODO(presley): Parse the packageJsonVersion and make sure it matches the
  // installed one.
  const modulePackageJsonPath = path.join(modulePath, "package.json");
  let modulePackageJson: any;
  try {
    const packageJsonString = ctx.fs.readUtf8File(modulePackageJsonPath);
    modulePackageJson = JSON.parse(packageJsonString);
  } catch (error: any) {
    // eslint-disable-next-line no-restricted-syntax
    throw new Error(`Missing ${modulePackageJsonPath}.`);
  }
  if (modulePackageJson["version"] === undefined) {
    // eslint-disable-next-line no-restricted-syntax
    throw new Error(`${packageJsonPath} misses a 'version' field.`);
  }
  return modulePackageJson["version"];
}
