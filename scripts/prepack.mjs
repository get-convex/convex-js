import url from "url";
import path from "path";
import fs from "fs";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
const convexDir = path.join(__dirname, "..");

assertNoTarballs(convexDir);

function assertNoTarballs(dirname) {
  const files = fs.readdirSync(dirname);
  const tarballs = files.filter((f) => f.endsWith(".tgz"));
  if (tarballs.length) {
    throw new Error("tarball already present, please delete first");
  }
}
