import esbuild from "esbuild";
import path from "path";
import prettier from "prettier";
import { mkdtemp, nodeFs, TempDir } from "../../bundler/fs.js";
import { entryPoints, walkDir } from "../../bundler/index.js";
import { apiCodegen } from "../codegen_templates/api.js";
import { GeneratedJsWithTypes } from "../codegen_templates/common.js";
import {
  dataModel,
  dataModelWithoutSchema,
} from "../codegen_templates/dataModel.js";
import { reactCodegen } from "../codegen_templates/react.js";
import { readmeCodegen } from "../codegen_templates/readme.js";
import { serverCodegen } from "../codegen_templates/server.js";
import { tsconfigCodegen } from "../codegen_templates/tsconfig.js";
import { ProjectConfig } from "./config.js";
import { Context, logMessage } from "./context.js";
import { typeCheckFunctionsInMode, TypeCheckMode } from "./typecheck.js";
import { functionsDir } from "./utils.js";

/**
 * Run prettier so we don't have to think about formatting!
 *
 * This is a little sketchy because we are using the default prettier config
 * (not our user's one) but it's better than nothing.
 */
function format(source: string, filetype: string): string {
  return prettier.format(source, { parser: filetype });
}

/**
 * Compile ESM-format (import/export) to CJS (require/exports).
 *
 * Codegen output is generally ESM format, but in some Node zero-bundle
 * setups it's useful to use CommonJS format for JavaScript output.
 */
function compileToCommonJS(source: string): string {
  const { code } = esbuild.transformSync(source, {
    format: "cjs",
    target: "node14",
    minify: false,
  });
  return code;
}

function writeFile(
  ctx: Context,
  filename: string,
  source: string,
  dir: TempDir,
  dryRun: boolean,
  debug: boolean,
  quiet: boolean,
  filetype = "typescript"
) {
  const formattedSource = format(source, filetype);
  const dest = path.join(dir.tmpPath, filename);
  if (debug) {
    logMessage(ctx, `# ${filename}`);
    logMessage(ctx, formattedSource);
    return;
  }
  if (dryRun) {
    if (ctx.fs.exists(dest)) {
      const fileText = ctx.fs.readUtf8File(dest);
      if (fileText !== formattedSource) {
        logMessage(ctx, `Command would replace file: ${dest}`);
      }
    } else {
      logMessage(ctx, `Command would create file: ${dest}`);
    }
    return;
  }

  if (!quiet) {
    logMessage(ctx, `writing ${filename}`);
  }

  nodeFs.writeUtf8File(dest, formattedSource);
}

function writeJsWithTypes(
  ctx: Context,
  name: string,
  content: GeneratedJsWithTypes,
  codegenDir: TempDir,
  dryRun: boolean,
  debug: boolean,
  quiet: boolean,
  commonjs: boolean
) {
  // Writing the same .d.ts for commonJS should work as long as we don't use
  // default exports.
  writeFile(ctx, `${name}.d.ts`, content.DTS, codegenDir, dryRun, debug, quiet);
  if (content.JS) {
    const js = commonjs ? compileToCommonJS(content.JS) : content.JS;
    writeFile(ctx, `${name}.js`, js, codegenDir, dryRun, debug, quiet);
  }
}

function doServerCodegen(
  ctx: Context,
  codegenDir: TempDir,
  dryRun: boolean,
  hasSchemaFile: boolean,
  debug: boolean,
  quiet = false,
  commonjs = false
) {
  if (hasSchemaFile) {
    writeJsWithTypes(
      ctx,
      "dataModel",
      dataModel,
      codegenDir,
      dryRun,
      debug,
      quiet,
      commonjs
    );
  } else {
    writeJsWithTypes(
      ctx,
      "dataModel",
      dataModelWithoutSchema,
      codegenDir,
      dryRun,
      debug,
      quiet,
      commonjs
    );
  }
  writeJsWithTypes(
    ctx,
    "server",
    serverCodegen(),
    codegenDir,
    dryRun,
    debug,
    quiet,
    commonjs
  );
}

async function doApiCodegen(
  ctx: Context,
  functionsDir: string,
  codegenDir: TempDir,
  dryRun: boolean,
  debug: boolean,
  quiet = false,
  commonjs = false
) {
  const modulePaths = (await entryPoints(ctx.fs, functionsDir, false)).map(
    entryPoint => path.relative(functionsDir, entryPoint)
  );
  writeJsWithTypes(
    ctx,
    "api",
    apiCodegen(modulePaths),
    codegenDir,
    dryRun,
    debug,
    quiet,
    commonjs
  );
}

async function doReactCodegen(
  ctx: Context,
  codegenDir: TempDir,
  dryRun: boolean,
  debug: boolean,
  quiet = false,
  commonjs = false
) {
  writeJsWithTypes(
    ctx,
    "react",
    reactCodegen(),
    codegenDir,
    dryRun,
    debug,
    quiet,
    commonjs
  );
}

export async function doCodegen({
  ctx,
  projectConfig,
  configPath,
  typeCheckMode,
  dryRun = false,
  debug = false,
  quiet = false,
  commonjs = false,
}: {
  ctx: Context;
  projectConfig: ProjectConfig;
  configPath: string;
  typeCheckMode: TypeCheckMode;
  dryRun?: boolean;
  debug?: boolean;
  quiet?: boolean;
  commonjs?: boolean;
}): Promise<void> {
  const funcDir = functionsDir(configPath, projectConfig);

  // Delete the old _generated.ts because v0.1.2 used to put the react generated
  // code there
  const legacyCodegenPath = path.join(funcDir, "_generated.ts");
  if (ctx.fs.exists(legacyCodegenPath)) {
    if (!dryRun) {
      console.log(`Deleting legacy codegen file: ${legacyCodegenPath}}`);
      ctx.fs.unlink(legacyCodegenPath);
    } else {
      console.log(
        `Command would delete legacy codegen file: ${legacyCodegenPath}}`
      );
    }
  }

  // Create the function dir if it doesn't already exist.
  ctx.fs.mkdir(funcDir, { allowExisting: true });

  const schemaPath = path.join(funcDir, "schema.ts");
  const hasSchemaFile = ctx.fs.exists(schemaPath);

  // Recreate the codegen directory in a temp location
  await mkdtemp("_generated", async tempCodegenDir => {
    // Do things in a careful order so that we always generate code in
    // dependency order.
    //
    // Ideally we would also typecheck sources before we use them. However,
    // we can't typecheck a single file while respecting the tsconfig, which can
    // produce misleading errors. Instead, we'll typecheck the generated code at
    // the end.
    //
    // The dependency chain is:
    // _generated/react.js
    // -> query and mutation functions
    // -> _generated/server.js
    // -> schema.ts
    // (where -> means "depends on")

    // 1. Use the schema.ts file to create the server codegen
    doServerCodegen(
      ctx,
      tempCodegenDir,
      dryRun,
      hasSchemaFile,
      debug,
      quiet,
      commonjs
    );

    // 2. Generate API
    await doApiCodegen(ctx, funcDir, tempCodegenDir, dryRun, debug, quiet);

    // 3. Generate the React code
    await doReactCodegen(ctx, tempCodegenDir, dryRun, debug, quiet, commonjs);

    // Replace the codegen directory with its new contents
    if (!debug && !dryRun) {
      const codegenDir = path.join(funcDir, "_generated");
      syncFromTemp(ctx, tempCodegenDir, codegenDir, true);
    }

    // Generated code is updated, typecheck the query and mutation functions.
    await typeCheckFunctionsInMode(ctx, typeCheckMode, funcDir);
  });
}

// TODO: this externalizes partial state to the watching dev server (eg vite)
// Frameworks appear to be resilient to this - but if we find issues, we
// could tighten this up per exchangedata(2) and renameat(2) - working
// under the assumption that the temp dir is on the same filesystem
// as the watched directory.
function syncFromTemp(
  ctx: Context,
  tempDir: TempDir,
  destDir: string,
  eliminateExtras: boolean // Eliminate extra files in destDir
) {
  ctx.fs.mkdir(destDir, { allowExisting: true });
  const added = new Set();
  // Copy in the newly codegen'd files
  // Use Array.from to prevent mutation-while-iterating
  for (const { isDir, path: fpath } of Array.from(
    walkDir(ctx.fs, tempDir.tmpPath)
  )) {
    const relPath = path.relative(tempDir.tmpPath, fpath);
    const destPath = path.join(destDir, relPath);

    // Remove anything existing at the dest path.
    if (ctx.fs.exists(destPath)) {
      if (ctx.fs.stat(destPath).isDirectory()) {
        if (!isDir) {
          // converting dir -> file. Blow away old dir.
          ctx.fs.rm(destPath, { recursive: true });
        }
        // Keep directory around in this case.
      } else {
        // Blow away files
        ctx.fs.unlink(destPath);
      }
    }

    // Move in the new file
    if (isDir) {
      ctx.fs.mkdir(destPath, { allowExisting: true });
    } else {
      ctx.fs.renameFile(fpath, destPath);
    }
    added.add(destPath);
  }
  // Eliminate any extra files/dirs in the destDir. Iterate in reverse topological
  // because we're removing files.
  // Use Array.from to prevent mutation-while-iterating
  if (eliminateExtras) {
    const destEntries = Array.from(walkDir(ctx.fs, destDir)).reverse();
    for (const { isDir, path: fpath } of destEntries) {
      if (!added.has(fpath)) {
        if (isDir) {
          ctx.fs.rmdir(fpath);
        } else {
          ctx.fs.unlink(fpath);
        }
      }
    }
  }
}

// Code generated on new project init, after which these files are not
// automatically written again in case developers have modified them.
export async function doInitCodegen(
  ctx: Context,
  functionsDir: string,
  quiet = false,
  dryRun = false,
  debug = false
) {
  await mkdtemp("convex", async tempFunctionsDir => {
    doReadmeCodegen(ctx, tempFunctionsDir, dryRun, debug, quiet);
    doTsconfigCodegen(ctx, tempFunctionsDir, dryRun, debug, quiet);
    syncFromTemp(ctx, tempFunctionsDir, functionsDir, false);
  });
}
function doReadmeCodegen(
  ctx: Context,
  tempFunctionsDir: TempDir,
  dryRun = false,
  debug = false,
  quiet = false
) {
  writeFile(
    ctx,
    "README.md",
    readmeCodegen(),
    tempFunctionsDir,
    dryRun,
    debug,
    quiet,
    "markdown"
  );
}
function doTsconfigCodegen(
  ctx: Context,
  tempFunctionsDir: TempDir,
  dryRun = false,
  debug = false,
  quiet = false
) {
  writeFile(
    ctx,
    "tsconfig.json",
    tsconfigCodegen(),
    tempFunctionsDir,
    dryRun,
    debug,
    quiet,
    "json"
  );
}
