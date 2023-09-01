/**
 * Create two new entry points for convex/browser just for Node.js.
 */
import url from "url";
import path from "path";
import fs from "fs";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
const convexDir = path.join(__dirname, "..");
const distDir = path.join(convexDir, "dist");
const cjsBrowserIndex = path.join(distDir, "cjs", "browser", "index.js");
const esmBrowserIndex = path.join(distDir, "esm", "browser", "index.js");
const cjsBrowserIndexNode = path.join(
  distDir,
  "cjs",
  "browser",
  "index-node.js"
);
const esmBrowserIndexNode = path.join(
  distDir,
  "esm",
  "browser",
  "index-node.js"
);

let output = fs.readFileSync(cjsBrowserIndex, { encoding: "utf-8" });
output = output.replace('"./http_client.js"', '"./http_client-node.js"');
fs.writeFileSync(cjsBrowserIndexNode, output, { encoding: "utf-8" });

output = fs.readFileSync(esmBrowserIndex, { encoding: "utf-8" });
output = output.replace('"./http_client.js"', '"./http_client-node.js"');
fs.writeFileSync(esmBrowserIndexNode, output, { encoding: "utf-8" });
