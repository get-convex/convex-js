#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const path = require("path");
const process = require("process");

// esbuild is a bundler, but we're not bundling
const allSourceFiles = [...walkSync("src")].filter(name => {
  if (name.startsWith("api")) {
    console.log("api:", name);
  }
  if (name.includes("test")) return false;
  // .d.ts files are manually copied over
  if (name.endsWith(".d.ts")) return false;
  return (
    name.endsWith(".ts") ||
    name.endsWith(".tsx") ||
    name.endsWith(".js") ||
    name.endsWith(".jsx")
  );
});

if (process.argv.includes("esm")) {
  require("esbuild")
    .build({
      entryPoints: allSourceFiles,
      bundle: false,
      sourcemap: true,
      outdir: "dist/esm",
      target: "es2020",
    })
    .catch(() => process.exit(1));
}

if (process.argv.includes("cjs")) {
  require("esbuild")
    .build({
      entryPoints: allSourceFiles,
      format: "cjs",
      bundle: false,
      sourcemap: true,
      outdir: "dist/cjs",
      target: "es2020",
    })
    .catch(() => process.exit(1));
}

if (process.argv.includes("browser-script-tag")) {
  require("esbuild")
    .build({
      entryPoints: ["src/browser/index.ts"],
      bundle: true,
      platform: "browser",
      sourcemap: true,
      outfile: "dist/browser.bundle.js",
      globalName: "convex",
      logLevel: "warning",
    })
    .catch(() => process.exit(1));
}

if (process.argv.includes("react-script-tag")) {
  const esbuild = require("esbuild");
  const { externalGlobalPlugin } = require("esbuild-plugin-external-global");
  esbuild
    .build({
      entryPoints: ["src/react/index.ts"],
      bundle: true,
      platform: "browser",
      external: ["react", "react-dom"],
      sourcemap: true,
      outfile: "dist/react.bundle.js",
      globalName: "convex",
      logLevel: "warning",
      plugins: [
        externalGlobalPlugin({
          react: "window.React",
          "react-dom": "window.ReactDOM",
        }),
      ],
    })
    .catch(() => process.exit(1));
}

if (process.argv.includes("standalone-cli")) {
  require("esbuild")
    .build({
      entryPoints: ["src/cli/index.ts"],
      bundle: true,
      platform: "node",
      sourcemap: true,
      target: "node14",
      external: ["esbuild", "fsevents"],
      outfile: "dist/cli.bundle.cjs",
      logLevel: "warning",
    })
    .catch(() => process.exit(1));
}

function* walkSync(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    if (file.isDirectory()) {
      yield* walkSync(path.join(dir, file.name));
    } else {
      yield path.join(dir, file.name);
    }
  }
}
