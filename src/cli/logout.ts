import { Command } from "@commander-js/extra-typings";
import { logFinishedStep, oneoffContext } from "../bundler/context.js";
import { recursivelyDelete } from "./lib/fsUtils.js";
import { globalConfigPath } from "./lib/utils/globalConfig.js";

export const logout = new Command("logout")
  .description("Log out of Convex on this machine")
  .allowExcessArguments(false)
  .action(async () => {
    const ctx = await oneoffContext({
      url: undefined,
      adminKey: undefined,
      envFile: undefined,
    });

    if (ctx.fs.exists(globalConfigPath())) {
      recursivelyDelete(ctx, globalConfigPath());
    }

    logFinishedStep(
      ctx,
      "You have been logged out of Convex.\n  Run `npx convex dev` to log in.",
    );
  });
