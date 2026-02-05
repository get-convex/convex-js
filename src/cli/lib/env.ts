import { chalkStderr } from "chalk";
import { Context } from "../../bundler/context.js";
import {
  logFailure,
  logFinishedStep,
  logMessage,
  logOutput,
} from "../../bundler/log.js";
import { runSystemQuery } from "./run.js";
import { deploymentFetch, logAndHandleFetchError } from "./utils/utils.js";
import { readFromStdin } from "./utils/stdin.js";

export async function envSetInDeployment(
  ctx: Context,
  deployment: {
    deploymentUrl: string;
    adminKey: string;
    deploymentNotice: string;
  },
  rawName: string,
  rawValue: string | undefined,
  options?: {
    secret?: boolean;
  },
) {
  const [name, value] = await allowEqualsSyntax(ctx, rawName, rawValue);
  await callUpdateEnvironmentVariables(ctx, deployment, [{ name, value }]);
  const formatted = /\s/.test(value) ? `"${value}"` : value;
  if (options?.secret) {
    logFinishedStep(
      `Successfully set ${chalkStderr.bold(name)} to ${chalkStderr.bold(formatted)}${deployment.deploymentNotice}`,
    );
  } else {
    logFinishedStep(`Successfully set ${chalkStderr.bold(name)}`);
  }
}

export async function envSetFromFileInDeployment(
  ctx: Context,
  deployment: {
    deploymentUrl: string;
    adminKey: string;
    deploymentNotice: string;
  },
  file: string,
) {
  const changes = await parseEnvFile(ctx, file);
  if (changes.length === 0) {
    logMessage(`No environment variables to set in file "${file}".`);
    return;
  }
  await callUpdateEnvironmentVariables(ctx, deployment, changes);
  logFinishedStep(`Successfully set ${chalk.bold(changes.length.toString())} environment variable(s) from file "${file}"${deployment.deploymentNotice}`);
}

async function allowEqualsSyntax(
  ctx: Context,
  name: string,
  value: string | undefined,
) {
  if (value === undefined) {
    if (/^[a-zA-Z][a-zA-Z0-9_]+=/.test(name)) {
      return name.split("=", 2);
    } else if (!process.stdin.isTTY) {
      // Read from stdin when piped input is available
      try {
        const stdinValue = await readFromStdin();
        return [name, stdinValue];
      } catch (error) {
        return await ctx.crash({
          exitCode: 1,
          errorType: "fatal",
          printedMessage: `error: failed to read from stdin: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } else {
      return await ctx.crash({
        exitCode: 1,
        errorType: "fatal",
        printedMessage: "error: missing required argument 'value'",
      });
    }
  }
  return [name, value];
}

async function parseEnvFile(
  ctx: Context,
  file: string,
): Promise<EnvVarChange[]> {
  let fileContents: string;
  try {
    fileContents = ctx.fs.readUtf8File(file);
  } catch (e) {
    return await ctx.crash({
      exitCode: 1,
      errorType: "fatal",
      printedMessage: `error: failed to read file "${file}": ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  const changes: EnvVarChange[] = [];
  const lines = fileContents.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      return await ctx.crash({
        exitCode: 1,
        errorType: "fatal",
        printedMessage: `error: invalid line ${i + 1} in file "${file}": missing '=' separator`,
      });
    }
    const name = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      return await ctx.crash({
        exitCode: 1,
        errorType: "fatal",
        printedMessage: `error: invalid environment variable name "${name}" on line ${i + 1} in file "${file}"`,
      });
    }
    changes.push({ name, value });
  }
  return changes;
}

export async function envGetInDeploymentAction(
  ctx: Context,
  deployment: {
    deploymentUrl: string;
    adminKey: string;
  },
  name: string,
) {
  const envVar = await envGetInDeployment(ctx, deployment, name);
  if (envVar === null) {
    logFailure(`Environment variable "${name}" not found.`);
    return;
  }
  logOutput(`${envVar}`);
}

export async function envGetInDeployment(
  ctx: Context,
  deployment: {
    deploymentUrl: string;
    adminKey: string;
  },
  name: string,
): Promise<string | null> {
  const envVar = (await runSystemQuery(ctx, {
    ...deployment,
    functionName: "_system/cli/queryEnvironmentVariables:get",
    componentPath: undefined,
    args: { name },
  })) as EnvVar | null;
  return envVar === null ? null : envVar.value;
}

export async function envRemoveInDeployment(
  ctx: Context,
  deployment: {
    deploymentUrl: string;
    adminKey: string;
    deploymentNotice: string;
  },
  name: string,
) {
  await callUpdateEnvironmentVariables(ctx, deployment, [{ name }]);
  logFinishedStep(
    `Successfully unset ${chalkStderr.bold(name)}${deployment.deploymentNotice}`,
  );
}

export async function envListInDeployment(
  ctx: Context,
  deployment: {
    deploymentUrl: string;
    adminKey: string;
  },
) {
  const envs = (await runSystemQuery(ctx, {
    ...deployment,
    functionName: "_system/cli/queryEnvironmentVariables",
    componentPath: undefined,
    args: {},
  })) as EnvVar[];
  if (envs.length === 0) {
    logMessage("No environment variables set.");
    return;
  }
  for (const { name, value } of envs) {
    logOutput(`${name}=${value}`);
  }
}

export type EnvVarChange = {
  name: string;
  value?: string;
};

export type EnvVar = {
  name: string;
  value: string;
};

export async function callUpdateEnvironmentVariables(
  ctx: Context,
  deployment: {
    deploymentUrl: string;
    adminKey: string;
    deploymentNotice: string;
  },
  changes: EnvVarChange[],
) {
  const fetch = deploymentFetch(ctx, deployment);
  try {
    await fetch("/api/update_environment_variables", {
      body: JSON.stringify({ changes }),
      method: "POST",
    });
  } catch (e) {
    return await logAndHandleFetchError(ctx, e);
  }
}

export async function fetchDeploymentCanonicalSiteUrl(
  ctx: Context,
  options: { deploymentUrl: string; adminKey: string },
): Promise<string> {
  const result = await envGetInDeployment(ctx, options, "CONVEX_SITE_URL");
  if (typeof result !== "string") {
    return await ctx.crash({
      exitCode: 1,
      errorType: "invalid filesystem or env vars",
      printedMessage: "Invalid process.env.CONVEX_SITE_URL",
    });
  }
  return result;
}
