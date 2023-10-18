import {
  Context,
  logMessage,
  logOutput,
  logWarning,
} from "../../bundler/context.js";
import { version } from "../version.js";
import { nextBackoff } from "../dev.js";
import chalk from "chalk";
import { deploymentClient } from "./utils.js";

const MAX_UDF_STREAM_FAILURE_COUNT = 5;

type LogDestination = "stdout" | "stderr";

export async function watchLogs(
  ctx: Context,
  url: string,
  adminKey: string,
  dest: LogDestination
) {
  const authHeader = createAuthHeader(adminKey);
  let numFailures = 0;
  let isFirst = true;
  let cursorMs = 0;

  for (;;) {
    try {
      const { entries, newCursor } = await pollUdfLog(
        cursorMs,
        url,
        authHeader
      );
      cursorMs = newCursor;
      numFailures = 0;
      // The first execution, we just want to fetch the current head cursor so we don't send stale
      // logs to the client.
      if (isFirst) {
        isFirst = false;
      } else {
        processLogs(ctx, entries, dest);
      }
    } catch (e) {
      numFailures += 1;
    }
    // Handle backoff
    if (numFailures > 0) {
      const backoff = nextBackoff(numFailures);

      // If we exceed a threshold number of failures, warn the user and display backoff.
      if (numFailures > MAX_UDF_STREAM_FAILURE_COUNT) {
        logWarning(
          ctx,
          `Convex [WARN] Failed to fetch logs. Waiting ${backoff}ms before next retry.`
        );
      }
      await new Promise((resolve) => {
        setTimeout(() => resolve(null), backoff);
      });
    }
  }
}

function createAuthHeader(adminKey: string): string {
  return `Convex ${adminKey}`;
}

type UdfType = "Query" | "Mutation" | "Action" | "HttpAction";

type UdfExecutionResponse = {
  identifier: string;
  udfType: UdfType;
  logLines: string[];
  // Unix timestamp (in seconds)
  timestamp: number;
  // UDF execution duration (in seconds)
  executionTime: number;
  error: string | null;
};

async function pollUdfLog(
  cursor: number,
  url: string,
  authHeader: string
): Promise<{ entries: UdfExecutionResponse[]; newCursor: number }> {
  const client = deploymentClient(url);
  const response = await client.get(
    `/api/stream_udf_execution?cursor=${cursor}`,
    {
      headers: {
        Authorization: authHeader,
        "Convex-Client": `npm-cli-${version}`,
      },
    }
  );
  return response.data;
}

const prefixForSource = (udfType: UdfType): string => {
  return udfType.charAt(0);
};

function processLogs(
  ctx: Context,
  rawLogs: UdfExecutionResponse[],
  dest: LogDestination
) {
  for (let i = 0; i < rawLogs.length; i++) {
    if (rawLogs[i].logLines) {
      const id = rawLogs[i].identifier;
      const udfType = rawLogs[i].udfType;

      for (let j = 0; j < rawLogs[i].logLines.length; j++) {
        logToTerminal(ctx, "info", udfType, id, rawLogs[i].logLines[j], dest);
      }
      if (rawLogs[i].error) {
        logToTerminal(ctx, "error", udfType, id, rawLogs[i].error!, dest);
      }
    }
  }
}

function logToTerminal(
  ctx: Context,
  type: "info" | "error",
  udfType: UdfType,
  udfPath: string,
  message: string,
  dest: LogDestination
) {
  const prefix = prefixForSource(udfType);
  if (type === "info") {
    const match = message.match(/^\[.*?\] /);
    if (match === null) {
      logToDestination(
        ctx,
        dest,
        chalk.red(`[CONVEX ${prefix}(${udfPath})] Could not parse console.log`)
      );
      return;
    }
    const level = message.slice(1, match[0].length - 2);
    const args = message.slice(match[0].length);

    logToDestination(
      ctx,
      dest,
      chalk.cyan(`> [CONVEX ${prefix}(${udfPath})] [${level}]`),
      args
    );
  } else {
    logToDestination(
      ctx,
      dest,
      chalk.red(`> [CONVEX ${prefix}(${udfPath})] ${message}`)
    );
  }
}

function logToDestination(ctx: Context, dest: LogDestination, ...logged: any) {
  switch (dest) {
    case "stdout":
      logOutput(ctx, ...logged);
      break;
    case "stderr":
      logMessage(ctx, ...logged);
      break;
  }
}
