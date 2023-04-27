import { Command } from "commander";
import open from "open";
import { configFilepath, parseProjectConfig } from "./lib/config.js";
import chalk from "chalk";
import { bigBrainClient, deprecationCheckWarning } from "./lib/utils.js";
import { oneoffContext } from "./lib/context.js";

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

export const docs = new Command("docs")
  .description("Open the docs in the browser")
  .option("--no-open", "Print docs URL instead of opening it in your browser")
  .action(async options => {
    const ctx = oneoffContext;
    const configPath = await configFilepath(ctx);
    let config;

    try {
      config = parseProjectConfig(JSON.parse(ctx.fs.readUtf8File(configPath)));
    } catch (err) {
      await openDocs(options.open);
      return;
    }
    const getCookieUrl = `get_cookie_for_project/${config.team}/${config.project}`;
    const client = await bigBrainClient(ctx);
    try {
      const res = await client.get(getCookieUrl);
      deprecationCheckWarning(ctx, res);
      await openDocs(options.open, res.data.cookie);
    } catch {
      await openDocs(options.open);
    }
  });
