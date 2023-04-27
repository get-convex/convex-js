import chalk from "chalk";
import { Context } from "./context.js";
import { getUrlAndAdminKey } from "./api.js";
import { doCodegen } from "./codegen.js";
import {
  configName,
  pullConfig,
  readProjectConfig,
  removedExistingConfig,
  writeProjectConfig,
} from "./config.js";
import { logFinishedStep, showSpinner } from "./context.js";
import { validateOrSelectProject, validateOrSelectTeam } from "./utils.js";
import {
  askAboutWritingToEnv,
  logConfiguration,
  writeToEnv,
} from "./envvars.js";

export async function reinit(
  ctx: Context,
  config: {
    team: string | null;
    project: string | null;
  },
  saveUrl: "yes" | "no" | "ask" = "ask",
  promptForAdditionalSteps?: () => Promise<() => Promise<void>>,
  options: { allowExistingConfig?: boolean } = { allowExistingConfig: false }
) {
  const configFn = configName();
  if (ctx.fs.exists(configFn)) {
    if (!removedExistingConfig(ctx, configFn, options)) {
      console.error(chalk.red(`File "${configFn}" already exists.`));
      console.error(
        "If you'd like to regenerate it, delete the file and rerun `npx convex reinit`"
      );
      return await ctx.crash(1, "invalid filesystem data");
    }
  }

  const { teamSlug } = await validateOrSelectTeam(ctx, config.team, "Team:");

  const projectSlug = await validateOrSelectProject(
    ctx,
    config.project,
    teamSlug,
    "Configure project",
    "Project:"
  );
  if (!projectSlug) {
    console.log("Aborted");
    return;
  }

  const prodEnvVarWrite = await askAboutWritingToEnv(
    ctx,
    "prod",
    null,
    saveUrl
  );

  const executeAdditionalSteps = await promptForAdditionalSteps?.();

  showSpinner(ctx, `Reinitializing project ${projectSlug}...\n`);

  const { url, adminKey } = await getUrlAndAdminKey(
    ctx,
    projectSlug,
    teamSlug,
    "prod"
  );
  {
    const { projectConfig } = await pullConfig(
      ctx,
      projectSlug,
      teamSlug,
      url,
      adminKey
    );
    await writeProjectConfig(ctx, projectConfig);
  }

  const { projectConfig, configPath } = await readProjectConfig(ctx);
  await doCodegen({
    ctx,
    projectConfig,
    configPath,
    typeCheckMode: "disable",
    quiet: true,
  });

  logFinishedStep(ctx, `Convex configuration written to ${configPath}`);
  await writeToEnv(ctx, prodEnvVarWrite, projectConfig.prodUrl);
  logConfiguration(ctx, prodEnvVarWrite, "prod", projectConfig.prodUrl);
  await executeAdditionalSteps?.();
}
