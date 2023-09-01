import {
  Context,
  logError,
  logMessage,
  logWarning,
} from "../../bundler/context.js";
import { version } from "../../index.js";
import axios from "axios";
import { nextBackoff } from "../dev.js";
import chalk from "chalk";

const MAX_UDF_STREAM_FAILURE_COUNT = 5;

export async function watchLogs(ctx: Context, url: string, adminKey: string) {
  const authHeader = create_auth_header(adminKey);
  let numFailures = 0;
  let isFirst = true;
  let cursorMs = 0;

  for (;;) {
    try {
      const { entries, newCursor } = await poll_udf_log(
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
        processLogs(ctx, entries);
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

function create_auth_header(adminKey: string): string {
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
  // Response status
  success: any;
  error: string | null;
};

async function poll_udf_log(
  cursor: number,
  url: string,
  authHeader: string
): Promise<{ entries: UdfExecutionResponse[]; newCursor: number }> {
  const response = await axios.get(
    `${url}/api/stream_udf_execution?cursor=${cursor}`,
    {
      headers: {
        Authorization: authHeader,
        "Convex-Client": `npm-cli-${version}`,
      },
    }
  );
  return response.data;
}

const prefix_for_source = (udfType: UdfType): string => {
  return udfType.charAt(0);
};

function processLogs(ctx: Context, rawLogs: UdfExecutionResponse[]) {
  for (let i = 0; i < rawLogs.length; i++) {
    if (rawLogs[i].logLines) {
      const id = rawLogs[i].identifier;
      const udfType = rawLogs[i].udfType;

      for (let j = 0; j < rawLogs[i].logLines.length; j++) {
        logToTerminal(ctx, "info", udfType, id, rawLogs[i].logLines[j]);
      }
      if (rawLogs[i].error) {
        logToTerminal(ctx, "error", udfType, id, rawLogs[i].error!);
      }
    }
  }
}

function logToTerminal(
  ctx: Context,
  type: "info" | "error",
  udfType: UdfType,
  udfPath: string,
  message: string
) {
  const prefix = prefix_for_source(udfType);
  if (type === "info") {
    const match = message.match(/^\[.*?\] /);
    if (match === null) {
      logError(
        ctx,
        chalk.red(`[CONVEX ${prefix}(${udfPath})] Could not parse console.log`)
      );
      return;
    }
    const level = message.slice(1, match[0].length - 2);
    const args = message.slice(match[0].length);

    logMessage(
      ctx,
      chalk.cyan(`> [CONVEX ${prefix}(${udfPath})] [${level}]`),
      args
    );
  } else {
    logError(ctx, chalk.red(`> [CONVEX ${prefix}(${udfPath})] ${message}`));
  }
}
