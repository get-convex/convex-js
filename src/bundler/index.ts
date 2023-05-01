import { parse as parseAST } from "@babel/parser";
import path from "path";
import chalk from "chalk";
import esbuild from "esbuild";
import { Filesystem } from "./fs.js";
import { wasmPlugin } from "./wasm.js";
export { nodeFs, RecordingFs } from "./fs.js";
export type { Filesystem } from "./fs.js";

export const actionsDir = "actions";

// Returns a generator of { isDir, path } for all paths
// within dirPath in some topological order (not including
// dirPath itself).
export function* walkDir(
  fs: Filesystem,
  dirPath: string
): Generator<{ isDir: boolean; path: string }, void, void> {
  for (const dirEntry of fs.listDir(dirPath)) {
    const childPath = path.join(dirPath, dirEntry.name);
    if (dirEntry.isDirectory()) {
      yield { isDir: true, path: childPath };
      yield* walkDir(fs, childPath);
    } else if (dirEntry.isFile()) {
      yield { isDir: false, path: childPath };
    }
  }
}

// Convex specific module environment.
type ModuleEnvironment = "node" | "isolate";

export interface Bundle {
  path: string;
  source: string;
  sourceMap?: string;
  environment: ModuleEnvironment;
}

export class BundleError extends Error {}

type EsBuildResult = esbuild.BuildResult & {
  outputFiles: esbuild.OutputFile[];
};

async function doEsbuild(
  fs: Filesystem,
  dir: string,
  entryPoints: string[],
  generateSourceMaps: boolean,
  platform: esbuild.Platform,
  chunksFolder: string
): Promise<EsBuildResult> {
  try {
    const result = await esbuild.build({
      entryPoints,
      bundle: true,
      platform: platform,
      format: "esm",
      target: "esnext",
      outdir: "out",
      outbase: dir,
      plugins: [wasmPlugin],
      write: false,
      sourcemap: generateSourceMaps,
      splitting: true,
      chunkNames: path.join(chunksFolder, "[hash]"),
      treeShaking: true,
      minify: false,
      keepNames: true,
      metafile: true,
    });

    for (const [relPath, input] of Object.entries(result.metafile!.inputs)) {
      // TODO: esbuild outputs paths prefixed with "(disabled)"" when bundling our internal
      // udf-system package. The files do actually exist locally, though.
      if (
        relPath.indexOf("(disabled):") !== -1 ||
        relPath.startsWith("wasm-binary:") ||
        relPath.startsWith("wasm-stub:")
      ) {
        continue;
      }
      const absPath = path.resolve(relPath);
      const st = fs.stat(absPath);
      if (st.size !== input.bytes) {
        throw new Error(
          `Bundled file ${absPath} changed right after esbuild invocation`
        );
      }
      fs.registerPath(absPath, st);
    }
    return result;
  } catch (err) {
    throw new BundleError(`esbuild failed: ${(err as any).toString()}`);
  }
}

export async function bundle(
  fs: Filesystem,
  dir: string,
  entryPoints: string[],
  generateSourceMaps: boolean,
  platform: esbuild.Platform,
  chunksFolder = "_deps"
): Promise<Bundle[]> {
  const result = await doEsbuild(
    fs,
    dir,
    entryPoints,
    generateSourceMaps,
    platform,
    chunksFolder
  );
  if (result.errors.length) {
    for (const error of result.errors) {
      console.log(chalk.red(`esbuild error: ${error.text}`));
    }
    throw new BundleError("esbuild failed");
  }
  for (const warning of result.warnings) {
    console.log(chalk.yellow(`esbuild warning: ${warning.text}`));
  }
  const sourceMaps = new Map();
  const modules: Bundle[] = [];
  const environment = platform === "node" ? "node" : "isolate";
  for (const outputFile of result.outputFiles) {
    const relPath = path.relative(path.normalize("out"), outputFile.path);
    if (path.extname(relPath) === ".map") {
      sourceMaps.set(relPath, outputFile.text);
      continue;
    }
    const posixRelPath = relPath.split(path.sep).join(path.posix.sep);
    modules.push({ path: posixRelPath, source: outputFile.text, environment });
  }
  for (const module of modules) {
    const sourceMapPath = module.path + ".map";
    const sourceMap = sourceMaps.get(sourceMapPath);
    if (sourceMap) {
      module.sourceMap = sourceMap;
    }
  }
  return modules;
}

export async function bundleSchema(fs: Filesystem, dir: string) {
  return bundle(fs, dir, [path.resolve(dir, "schema.ts")], true, "browser");
}

export async function entryPoints(
  fs: Filesystem,
  dir: string,
  verbose: boolean
): Promise<string[]> {
  const entryPoints = [];
  for (const { isDir, path: fpath } of walkDir(fs, dir)) {
    if (isDir) {
      continue;
    }
    const relPath = path.relative(dir, fpath);
    const base = path.parse(fpath).base;

    const log = (line: string) => {
      if (verbose) {
        console.log(line);
      }
    };

    if (relPath.startsWith("_deps" + path.sep)) {
      throw new Error(
        `The path "${fpath}" is within the "_deps" directory, which is reserved for dependencies. Please move your code to another directory.`
      );
    } else if (relPath.startsWith("_generated" + path.sep)) {
      log(chalk.yellow(`Skipping ${fpath}`));
    } else if (base.startsWith(".")) {
      log(chalk.yellow(`Skipping dotfile ${fpath}`));
    } else if (base === "README.md") {
      log(chalk.yellow(`Skipping ${fpath}`));
    } else if (base === "_generated.ts") {
      log(chalk.yellow(`Skipping ${fpath}`));
    } else if (base === "schema.ts") {
      log(chalk.yellow(`Skipping ${fpath}`));
    } else if (base.includes(".test.")) {
      log(chalk.yellow(`Skipping ${fpath}`));
    } else if (base === "tsconfig.json") {
      log(chalk.yellow(`Skipping ${fpath}`));
    } else if (relPath.includes(" ")) {
      log(chalk.yellow(`Skipping ${relPath} because it contains a space`));
    } else if (base.endsWith(".d.ts")) {
      log(chalk.yellow(`Skipping ${fpath} declaration file`));
    } else {
      log(chalk.green(`Preparing ${fpath}`));
      entryPoints.push(fpath);
    }
  }
  return entryPoints;
}

// A fallback regex in case we fail to parse the AST.
export const useNodeDirectiveRegex = /^\s*("|')use node("|');?\s*$/;

function hasUseNodeDirective(
  fs: Filesystem,
  fpath: string,
  verbose: boolean
): boolean {
  // Do a quick check for the exact string. If it doesn't exist, don't
  // bother parsing.
  const source = fs.readUtf8File(fpath);
  if (source.indexOf("use node") === -1) {
    return false;
  }

  // We parse the AST here to extract the "use node" declaration. This is more
  // robust than doing a regex. We only use regex as a fallback.
  try {
    const ast = parseAST(source, {
      // parse in strict mode and allow module declarations
      sourceType: "module",

      // esbuild supports jsx and typescript by default. Allow the same plugins
      // here too.
      plugins: ["jsx", "typescript"],
    });
    return ast.program.directives.map(d => d.value.value).includes("use node");
  } catch (error: any) {
    // Given that we have failed to parse, we are most likely going to fail in
    // the esbuild step, which seem to return better formatted error messages.
    // We don't throw here and fallback to regex.
    let lineMatches = false;
    for (const line of source.split("\n")) {
      if (line.match(useNodeDirectiveRegex)) {
        lineMatches = true;
        break;
      }
    }

    if (verbose) {
      // Log that we failed to parse in verbose node if we need this for debugging.
      console.warn(
        `Failed to parse ${fpath}. Use node is set to ${lineMatches} based on regex. Parse error: ${error.toString()}.`
      );
    }

    return lineMatches;
  }
}

export function mustBeIsolate(relPath: string): boolean {
  // Check if the path without extension matches any of the static paths.
  return ["http", "crons", "schema"].includes(relPath.replace(/\.[^/.]+$/, ""));
}

function determineEnvironment(
  fs: Filesystem,
  dir: string,
  fpath: string,
  verbose: boolean
): ModuleEnvironment {
  const relPath = path.relative(dir, fpath);

  const useNodeDirectiveFound = hasUseNodeDirective(fs, fpath, verbose);
  if (useNodeDirectiveFound) {
    if (mustBeIsolate(relPath)) {
      throw new BundleError(
        `"use node" directive is not allowed for ${relPath}.`
      );
    }
    return "node";
  }

  const actionsPrefix = actionsDir + path.sep;
  if (relPath.startsWith(actionsPrefix)) {
    throw new Error(
      `${relPath} is in /actions subfolder but has no "use node"; directive. You can now define actions in any folder and indicate they should run in node by adding "use node" directive. /actions is a deprecated way to choose Node.js environment, and we require "use node" for all files within that folder to avoid unexpected errors during the migration. See https://docs.convex.dev/functions/actions for more details`
    );
  }

  return "isolate";
}

export async function entryPointsByEnvironment(
  fs: Filesystem,
  dir: string,
  verbose: boolean
) {
  const isolate = [];
  const node = [];
  for (const entryPoint of await entryPoints(fs, dir, verbose)) {
    const environment = determineEnvironment(fs, dir, entryPoint, verbose);
    if (environment === "node") {
      node.push(entryPoint);
    } else {
      isolate.push(entryPoint);
    }
  }

  return { isolate, node };
}
