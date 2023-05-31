import inquirer from "inquirer";
import chalk from "chalk";
import { Command, Option } from "commander";
import path from "path";
import { performance } from "perf_hooks";
import {
  deploymentName,
  DeploymentType,
  getDevDeploymentMaybeThrows,
  getUrlAndAdminKeyByDeploymentType,
  getUrlAndAdminKeyFromSlug,
} from "./lib/api";
import {
  ProjectConfig,
  enforceDeprecatedConfigField,
  readProjectConfig,
  upgradeOldAuthInfoToAuthConfig,
} from "./lib/config";
import {
  Context,
  logError,
  logFailure,
  logFinishedStep,
  logMessage,
  oneoffContext,
  showSpinner,
  stopSpinner,
} from "../bundler/context";
import {
  askAboutWritingToEnv,
  logConfiguration,
  logProvisioning,
  offerToWriteToEnv,
  writeToEnv,
} from "./lib/envvars";
import { checkAuthorization, performLogin } from "./lib/login";
import { PushOptions, runPush } from "./lib/push";
import {
  logAndHandleAxiosError,
  formatDuration,
  getCurrentTimeString,
  hasProject,
  hasProjects,
  hasTeam,
  isInExistingProject as isInExistingProject,
  shouldUseNewFlow,
  getConfiguredDeployment,
  functionsDir,
} from "./lib/utils";
import { Crash, WatchContext, Watcher } from "./lib/watch";
import { init } from "./lib/init";
import { reinit } from "./lib/reinit";
import { writeDeploymentEnvVar } from "./lib/deployment";
import { writeProjectConfig } from "./lib/config";

export const dev = new Command("dev")
  .summary("Develop against a dev deployment, watching for changes")
  .description(
    "Configures a new or existing project if needed. Watches for local changes and pushes them" +
      " to the configured dev deployment. Updates generated types."
  )
  .option("-v, --verbose", "Show full listing of changes")
  .addOption(
    new Option(
      "--typecheck <mode>",
      `Check TypeScript files with \`tsc --noEmit\`.`
    )
      .choices(["enable", "try", "disable"])
      .default("try")
  )
  // TODO: deprecate
  .option("--save-url", "Save deployment URLs to .env and .env.local")
  // TODO: deprecate
  .option("--no-save-url", "Do not save deployment URLs to .env and .env.local")
  .addOption(
    new Option("--codegen <mode>", "Regenerate code in `convex/_generated/`")
      .choices(["enable", "disable"])
      .default("enable")
  )
  .option("--once", "Run only once, do not watch for changes")
  .addOption(
    new Option(
      "--configure <choice>",
      "Choose whether to configure new or existing project"
    )
      .choices(["new", "existing", "ask"])
      .default("ask")
  )
  .option("--team <team_slug>", "The team you'd like to use for this project")
  .option(
    "--project <project_slug>",
    "The name of the project you'd like to configure"
  )
  .addOption(
    new Option(
      "--prod",
      "Develop live against this project's production deployment."
    ).hideHelp()
  )
  .addOption(new Option("--trace-events").hideHelp())
  .addOption(new Option("--admin-key <adminKey>").hideHelp())
  .addOption(new Option("--url <url>").hideHelp())
  // Options for testing
  .addOption(new Option("--override-auth-url <url>").hideHelp())
  .addOption(new Option("--override-auth-client <id>").hideHelp())
  .addOption(new Option("--override-auth-username <username>").hideHelp())
  .addOption(new Option("--override-auth-password <password>").hideHelp())
  .showHelpAfterError()
  .action(async cmdOptions => {
    const ctx = oneoffContext;

    if (!cmdOptions.url || !cmdOptions.adminKey) {
      if (!(await checkAuthorization(ctx, false))) {
        await performLogin(ctx, cmdOptions);
      }
    }

    const chosenConfiguration: "new" | "existing" | null =
      cmdOptions.configure === "ask" ? null : cmdOptions.configure ?? null;

    if (shouldUseNewFlow()) {
      const credentials = await deploymentCredentialsOrConfigure(
        ctx,
        chosenConfiguration,
        cmdOptions
      );
      await watchAndPush(
        ctx,
        {
          ...credentials,
          verbose: !!cmdOptions.verbose,
          dryRun: false,
          typecheck: cmdOptions.typecheck,
          debug: false,
          codegen: cmdOptions.codegen === "enable",
        },
        cmdOptions
      );
      return;
    }

    const saveUrl =
      cmdOptions.saveUrl === true
        ? "yes"
        : cmdOptions.saveUrl === false
        ? "no"
        : "ask";

    let projectConfig: ProjectConfig | null = null;
    let options: PushOptions;

    const promptForDevDeployment = (isInit: boolean) => async () => {
      const devEnvVarWrite = await askAboutWritingToEnv(
        ctx,
        "dev",
        null,
        saveUrl
      );
      return async () => {
        projectConfig = (await readProjectConfig(ctx)).projectConfig;
        options = await getDevDeploymentOptions(ctx, projectConfig, cmdOptions);
        await writeToEnv(ctx, devEnvVarWrite, options.url);
        if (isInit) {
          logProvisioning(ctx, devEnvVarWrite, "dev", options.url);
        } else {
          logConfiguration(ctx, devEnvVarWrite, "dev", options.url);
        }
      };
    };

    const { team, project } = cmdOptions;

    if (!(await isInExistingProject(ctx))) {
      const choice = chosenConfiguration ?? (await askToConfigure(ctx));
      switch (choice) {
        case "new":
          await init(
            ctx,
            "prod",
            { team, project },
            saveUrl,
            promptForDevDeployment(true)
          );
          break;
        case "existing":
          await reinit(
            ctx,
            "prod",
            { team, project },
            saveUrl,
            promptForDevDeployment(false)
          );
          break;
        default: {
          const _exhaustivenessCheck: never = choice;
        }
      }
    } else {
      projectConfig = (await readProjectConfig(ctx)).projectConfig;
      try {
        options = await getDevDeploymentOptionsMaybeThrows(
          ctx,
          projectConfig,
          cmdOptions
        );
        await offerToWriteToEnv(ctx, "dev", options.url, saveUrl);
      } catch (error) {
        const choice =
          chosenConfiguration ??
          (await askToReconfigure(ctx, projectConfig, error));
        switch (choice) {
          case "new":
            await init(
              ctx,
              "prod",
              { team, project },
              saveUrl,
              promptForDevDeployment(true),
              { allowExistingConfig: true }
            );
            break;
          case "existing":
            await reinit(
              ctx,
              "prod",
              { team, project },
              saveUrl,
              promptForDevDeployment(false),
              { allowExistingConfig: true }
            );
            break;
          default: {
            const _exhaustivenessCheck: never = choice;
          }
        }
      }
    }

    await watchAndPush(ctx, options!, cmdOptions, projectConfig!);
  });

type DeploymentCredentials = {
  url: string;
  adminKey: string;
};

async function deploymentCredentialsOrConfigure(
  ctx: Context,
  chosenConfiguration: "new" | "existing" | null,
  cmdOptions: {
    prod: boolean;
    team: string | null;
    project: string | null;
    url?: string | undefined;
    adminKey?: string | undefined;
  }
): Promise<DeploymentCredentials> {
  const { url, adminKey } = cmdOptions;
  if (url !== undefined && adminKey !== undefined) {
    return { url, adminKey };
  }
  const deploymentType = cmdOptions.prod ? "prod" : "dev";
  const configuredDeployment =
    chosenConfiguration === null
      ? await getConfiguredDeploymentOrUpgrade(ctx, deploymentType)
      : null;
  // No configured deployment NOR existing config
  if (configuredDeployment === null) {
    const choice = chosenConfiguration ?? (await askToConfigure(ctx));
    return await initOrReinit(ctx, choice, deploymentType, cmdOptions);
  }
  // Existing config but user doesn't have access to it
  if ("error" in configuredDeployment) {
    const projectConfig = (await readProjectConfig(ctx)).projectConfig;
    const choice = await askToReconfigure(
      ctx,
      projectConfig,
      configuredDeployment.error
    );
    return initOrReinit(ctx, choice, deploymentType, cmdOptions);
  }
  const { deploymentName } = configuredDeployment;
  const adminKeyAndUrlForConfiguredDeployment = await getUrlAndAdminKeyFromSlug(
    ctx,
    deploymentName,
    deploymentType
  );
  // Configured deployment and user has access
  if (!("error" in adminKeyAndUrlForConfiguredDeployment)) {
    return adminKeyAndUrlForConfiguredDeployment;
  }
  await checkForDeploymentTypeError(
    ctx,
    adminKeyAndUrlForConfiguredDeployment.error
  );

  // Configured deployment and user doesn't has access to it
  const choice =
    chosenConfiguration ?? (await askToReconfigureNew(ctx, deploymentName));
  return initOrReinit(ctx, choice, deploymentType, cmdOptions);
}

async function checkForDeploymentTypeError(ctx: Context, error: unknown) {
  if ((error as any).response?.data?.code === "DeploymentTypeMismatch") {
    logFailure(
      ctx,
      "Use `npx convex deploy` to push changes to your production deployment configured in CONVEX_DEPLOYMENT"
    );
    logError(ctx, chalk.red((error as any).response.data.message));
    await ctx.crash(1, "invalid filesystem data", error);
  }
}

async function getConfiguredDeploymentOrUpgrade(
  ctx: Context,
  deploymentType: DeploymentType
) {
  const deploymentName = await getConfiguredDeployment(ctx);
  if (deploymentName !== null) {
    return { deploymentName };
  }
  return await upgradeOldConfigToDeploymentVar(ctx, deploymentType);
}

async function initOrReinit(
  ctx: Context,
  choice: "new" | "existing",
  deploymentType: DeploymentType,
  cmdOptions: { team: string | null; project: string | null }
): Promise<DeploymentCredentials> {
  switch (choice) {
    case "new":
      return (await init(ctx, deploymentType, cmdOptions))!;
    case "existing": {
      const credentials = (await reinit(ctx, deploymentType, cmdOptions))!;
      return credentials;
    }
    default: {
      return choice;
    }
  }
}

export async function watchAndPush(
  outerCtx: Context,
  options: PushOptions,
  cmdOptions: {
    once: boolean;
    traceEvents: boolean;
  },
  originalProjectConfig?: ProjectConfig
) {
  let watcher: Watcher | undefined;
  let numFailures = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = performance.now();
    const ctx = new WatchContext(cmdOptions.traceEvents);
    showSpinner(ctx, "Preparing Convex functions...");
    if (originalProjectConfig !== undefined) {
      // If the project or team slugs change, exit because that's the
      // simplest thing to do.
      const config = await readProjectConfig(ctx);
      if (
        originalProjectConfig.project !== config.projectConfig.project ||
        originalProjectConfig.team !== config.projectConfig.team
      ) {
        logFailure(ctx, "Detected a change in your `convex.json`. Exiting...");
        return await outerCtx.crash(1, "invalid filesystem data");
      }
    }

    try {
      await runPush(ctx, options);
      const end = performance.now();
      numFailures = 0;
      logFinishedStep(
        ctx,
        `${getCurrentTimeString()} Convex functions ready! (${formatDuration(
          end - start
        )})`
      );
    } catch (e: any) {
      // Crash the app on unexpected errors.
      if (!(e instanceof Crash) || !e.errorType) {
        // eslint-disable-next-line no-restricted-syntax
        throw e;
      }
      if (e.errorType === "fatal") {
        break;
      }
      // Retry after an exponential backoff if we hit a transient error.
      if (e.errorType === "transient") {
        const delay = nextBackoff(numFailures);
        numFailures += 1;
        console.error(
          chalk.yellow(
            `Failed due to network error, retrying in ${formatDuration(
              delay
            )}...`
          )
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      // Fall through if we had a filesystem-based error.
      console.assert(e.errorType === "invalid filesystem data");
      if (cmdOptions.once) {
        await outerCtx.crash(1, e.errorType);
      }
      // Make sure that we don't spin if this push failed
      // in any edge cases that didn't call `logFailure`
      // before throwing.
      stopSpinner(ctx);
    }
    if (cmdOptions.once) {
      return;
    }
    const observations = ctx.fs.finalize();
    if (observations === "invalidated") {
      console.error("Filesystem changed during push, retrying...");
      continue;
    }
    // Initialize the watcher if we haven't done it already. Chokidar expects to have a
    // nonempty watch set at initialization, so we can't do it before running our first
    // push.
    if (!watcher) {
      watcher = new Watcher(observations);
      await watcher.ready();
    }
    // Watch new directories if needed.
    watcher.update(observations);

    // Process events until we find one that overlaps with our previous observations.
    let anyChanges = false;
    do {
      await watcher.waitForEvent();
      for (const event of watcher.drainEvents()) {
        if (cmdOptions.traceEvents) {
          console.error(
            "Processing",
            event.name,
            path.relative("", event.absPath)
          );
        }
        const result = observations.overlaps(event);
        if (result.overlaps) {
          const relPath = path.relative("", event.absPath);
          if (cmdOptions.traceEvents) {
            console.error(`${relPath} ${result.reason}, rebuilding...`);
          }
          anyChanges = true;
          break;
        }
      }
    } while (!anyChanges);

    // Wait for the filesystem to quiesce before starting a new push. It's okay to
    // drop filesystem events at this stage since we're already committed to doing
    // a push and resubscribing based on that push's observations.
    let deadline = performance.now() + quiescenceDelay;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const now = performance.now();
      if (now >= deadline) {
        break;
      }
      const remaining = deadline - now;
      if (cmdOptions.traceEvents) {
        console.error(`Waiting for ${formatDuration(remaining)} to quiesce...`);
      }
      const remainingWait = new Promise<"timeout">(resolve =>
        setTimeout(() => resolve("timeout"), deadline - now)
      );
      const result = await Promise.race([
        remainingWait,
        watcher.waitForEvent().then<"newEvents">(() => "newEvents"),
      ]);
      if (result === "newEvents") {
        for (const event of watcher.drainEvents()) {
          const result = observations.overlaps(event);
          // Delay another `quiescenceDelay` since we had an overlapping event.
          if (result.overlaps) {
            if (cmdOptions.traceEvents) {
              console.error(
                `Received an overlapping event at ${event.absPath}, delaying push.`
              );
            }
            deadline = performance.now() + quiescenceDelay;
          }
        }
      } else {
        console.assert(result === "timeout");
        // Let the check above `break` from the loop if we're past our deadlne.
      }
    }
  }
}

async function upgradeOldConfigToDeploymentVar(
  ctx: Context,
  deploymentType: DeploymentType
): Promise<{ deploymentName: string } | { error: unknown } | null> {
  const { configPath, projectConfig } = await readProjectConfig(ctx);
  const { team, project } = projectConfig;
  if (typeof team !== "string" || typeof project !== "string") {
    // The config is not a valid old config, proceed to init/reinit
    return null;
  }
  let devDeploymentName;
  try {
    const { deploymentName } =
      deploymentType === "prod"
        ? // If we're upgrading from an old config "prod" is guaranteed to exist
          await getUrlAndAdminKeyByDeploymentType(
            ctx,
            project,
            team,
            deploymentType
          )
        : // But "dev" is not, this call provisions it on demand
          await getDevDeploymentMaybeThrows(ctx, {
            projectSlug: project,
            teamSlug: team,
          });
    devDeploymentName = deploymentName!;
  } catch (error) {
    // Could not retrieve the deployment name using the old config, proceed to reconfigure
    return { error };
  }
  await writeDeploymentEnvVar(ctx, deploymentType, {
    team,
    project,
    deploymentName: devDeploymentName,
  });
  logMessage(
    ctx,
    chalk.green(
      `Saved the ${deploymentType} deployment name as CONVEX_DEPLOYMENT to .env.local`
    )
  );
  const projectConfigWithoutAuthInfo = await upgradeOldAuthInfoToAuthConfig(
    ctx,
    projectConfig,
    functionsDir(configPath, projectConfig)
  );
  await writeProjectConfig(ctx, projectConfigWithoutAuthInfo, {
    deleteIfAllDefault: true,
  });
  return { deploymentName: devDeploymentName };
}

async function askToConfigure(ctx: Context): Promise<"new" | "existing"> {
  if (!(await hasProjects(ctx))) {
    return "new";
  }
  return await promptToInitWithProjects();
}

type DevDeploymentCmdOptions = {
  url?: string;
  adminKey?: string;
  prod?: boolean;
  verbose?: boolean;
  typecheck: "enable" | "try" | "disable";
  codegen: "enable" | "disable";
};

async function askToReconfigure(
  ctx: Context,
  projectConfig: ProjectConfig,
  error: unknown
): Promise<"new" | "existing"> {
  const team = await enforceDeprecatedConfigField(ctx, projectConfig, "team");
  const project = await enforceDeprecatedConfigField(
    ctx,
    projectConfig,
    "project"
  );
  const [isExistingTeam, existingProject, hasAnyProjects] = await Promise.all([
    await hasTeam(ctx, team),
    await hasProject(ctx, team, project),
    await hasProjects(ctx),
  ]);

  // The config is good so there must be something else going on,
  // fatal with the original error
  if (isExistingTeam && existingProject) {
    return await logAndHandleAxiosError(ctx, error);
  }

  if (isExistingTeam) {
    logFailure(
      ctx,
      `Project ${chalk.bold(project)} does not exist in your team ${chalk.bold(
        team
      )}, as configured in ${chalk.bold("convex.json")}`
    );
  } else {
    logFailure(
      ctx,
      `You don't have access to team ${chalk.bold(
        team
      )}, as configured in ${chalk.bold("convex.json")}`
    );
  }
  if (!hasAnyProjects) {
    const { confirmed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmed",
        message: `Create a new project?`,
        default: true,
      },
    ]);
    if (!confirmed) {
      console.error(
        "Run `npx convex dev` in a directory with a valid convex.json."
      );
      return await ctx.crash(1, "invalid filesystem data");
    }
    return "new";
  }

  return await promptToReconfigure();
}

async function askToReconfigureNew(
  ctx: Context,
  configuredDeploymentName: deploymentName
): Promise<"new" | "existing"> {
  logFailure(
    ctx,
    `You don't have access to the project with deployment ${chalk.bold(
      configuredDeploymentName
    )}, as configured in ${chalk.bold("CONVEX_DEPLOYMENT")}`
  );

  const hasAnyProjects = await hasProjects(ctx);

  if (!hasAnyProjects) {
    const { confirmed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmed",
        message: `Configure a new project?`,
        default: true,
      },
    ]);
    if (!confirmed) {
      console.error(
        "Run `npx convex dev` in a directory with a valid CONVEX_DEPLOYMENT set"
      );
      return await ctx.crash(1, "invalid filesystem data");
    }
    return "new";
  }

  return await promptToReconfigure();
}

async function getDevDeploymentOptions(
  ctx: Context,
  projectConfig: ProjectConfig,
  cmdOptions: DevDeploymentCmdOptions
): Promise<PushOptions> {
  try {
    return await getDevDeploymentOptionsMaybeThrows(
      ctx,
      projectConfig,
      cmdOptions
    );
  } catch (error) {
    return await logAndHandleAxiosError(ctx, error);
  }
}

async function getDevDeploymentOptionsMaybeThrows(
  ctx: Context,
  projectConfig: ProjectConfig,
  cmdOptions: DevDeploymentCmdOptions
): Promise<PushOptions> {
  const teamSlug = await enforceDeprecatedConfigField(
    ctx,
    projectConfig,
    "team"
  );
  const projectSlug = await enforceDeprecatedConfigField(
    ctx,
    projectConfig,
    "project"
  );

  let deployment: {
    url: string;
    adminKey: string;
  };
  if (!cmdOptions.url || !cmdOptions.adminKey) {
    if (cmdOptions.prod) {
      deployment = await getUrlAndAdminKeyByDeploymentType(
        ctx,
        projectSlug,
        teamSlug,
        "prod"
      );
      console.error("Found deployment ready");
    } else {
      deployment = await getDevDeploymentMaybeThrows(ctx, {
        projectSlug,
        teamSlug,
      });
    }
  }
  const adminKey = cmdOptions.adminKey ?? deployment!.adminKey;
  const url = cmdOptions.url ?? deployment!.url;
  return {
    adminKey,
    verbose: !!cmdOptions.verbose,
    dryRun: false,
    typecheck: cmdOptions.typecheck,
    debug: false,
    codegen: cmdOptions.codegen === "enable",
    url,
  };
}

const initialBackoff = 500;
const maxBackoff = 16000;
const quiescenceDelay = 500;

function nextBackoff(prevFailures: number): number {
  const baseBackoff = initialBackoff * Math.pow(2, prevFailures);
  const actualBackoff = Math.min(baseBackoff, maxBackoff);
  const jitter = actualBackoff * (Math.random() - 0.5);
  return actualBackoff + jitter;
}

export async function promptToInitWithProjects(): Promise<"new" | "existing"> {
  const { choice } = await inquirer.prompt([
    {
      type: "list",
      name: "choice",
      message: `What would you like to configure?`,
      default: "new",
      choices: [
        { name: "a new project", value: "new" },
        { name: "an existing project", value: "existing" },
      ],
    },
  ]);
  return choice;
}

export async function promptToReconfigure(): Promise<"new" | "existing"> {
  const { choice } = await inquirer.prompt([
    {
      type: "list",
      name: "choice",
      message: `Configure a different project?`,
      default: "new",
      choices: [
        { name: "create new project", value: "new" },
        { name: "choose an existing project", value: "existing" },
      ],
    },
  ]);
  return choice;
}
