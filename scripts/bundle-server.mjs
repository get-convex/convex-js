// We use an `.mjs` file instead of TypeScript so node can run the script directly.
import {
  bundle,
  nodeFs,
  entryPointsByEnvironment,
} from "../dist/esm/bundler/index.js";
import path from "path";

if (process.argv.length < 3) {
  throw new Error(
    "USAGE: node bundle-server.mjs <udf system dir> <system dir>*"
  );
}
const systemDirs = process.argv.slice(3);
const out = [];

// Only bundle "setup.ts" from `udf/_system`.
const udfDir = process.argv[2];
const setupPath = path.join(udfDir, "setup.ts");
const setupBundles = await bundle(
  nodeFs,
  process.argv[2],
  [setupPath],
  true,
  "browser"
);
if (setupBundles.length !== 1) {
  throw new Error("Got more than one setup bundle?");
}
out.push(...setupBundles);

for (const systemDir of systemDirs) {
  if (path.basename(systemDir) !== "_system") {
    throw new Error(`Refusing to bundle non-system directory ${systemDir}`);
  }
  const entryPoints = await entryPointsByEnvironment(nodeFs, systemDir, false);
  const bundles = await bundle(
    nodeFs,
    systemDir,
    entryPoints.isolate,
    false,
    "browser"
  );
  out.push(...bundles);
}
process.stdout.write(JSON.stringify(out));
