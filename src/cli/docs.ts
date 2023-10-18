import { Command } from "commander";
import open from "open";
import chalk from "chalk";
import {
  bigBrainClient,
  deprecationCheckWarning,
  getAuthHeaderFromGlobalConfig,
} from "./lib/utils.js";
import { oneoffContext } from "../bundler/context.js";
import { readDeploymentEnvVar } from "./lib/deployment.js";

export const docs = new Command("docs")
  .description("Open the docs in the browser")
  .option("--no-open", "Print docs URL instead of opening it in your browser")
  .action(async (options) => {
    const ctx = oneoffContext;
    // Usually we'd call `getConfiguredDeployment` but in this
    // command we don't care at all if the user is in the right directory
    const configuredDeployment = readDeploymentEnvVar();
    const getCookieUrl = `get_cookie/${configuredDeployment}`;
    const client = await bigBrainClient(ctx, getAuthHeaderFromGlobalConfig);
    try {
      const res = await client.get(getCookieUrl);
      deprecationCheckWarning(ctx, res);
      await openDocs(options.open, res.data.cookie);
    } catch {
      await openDocs(options.open);
    }
  });

async function openDocs(toOpen: boolean, cookie?: string) {
  let docsUrl = "https://docs.convex.dev";
  if (cookie !== undefined) {
    docsUrl += "/?t=" + cookie;
  }
  if (toOpen) {
    await open(docsUrl);
    console.log(chalk.green("Docs have launched! Check your browser."));
  } else {
    console.log(chalk.green(`Find Convex docs here: ${docsUrl}`));
  }
}
