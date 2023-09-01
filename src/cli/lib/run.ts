import chalk from "chalk";
import util from "util";
import ws from "ws";
import { ConvexHttpClient } from "../../browser/http_client-node.js";
import { BaseConvexClient } from "../../browser/index.js";
import { makeFunctionReference } from "../../server/index.js";
import { Value, convexToJson } from "../../values/value.js";
import {
  Context,
  logError,
  logFailure,
  logFinishedStep,
  logMessage,
  logOutput,
} from "../../bundler/context.js";

export async function runFunctionAndLog(
  ctx: Context,
  deploymentUrl: string,
  adminKey: string,
  functionName: string,
  args: Value,
  callbacks?: {
    onSuccess?: () => void;
  }
) {
  const client = new ConvexHttpClient(deploymentUrl);
  client.setAdminAuth(adminKey);

  let result: Value;
  try {
    result = await client.function(makeFunctionReference(functionName), args);
  } catch (err) {
    logFailure(ctx, `Failed to run function "${functionName}":`);
    logError(ctx, chalk.red((err as Error).toString().trim()));
    return await ctx.crash(1, "invalid filesystem or env vars");
  }

  callbacks?.onSuccess?.();

  // `null` is the default return type
  if (result !== null) {
    logOutput(ctx, formatValue(result));
  }
}

export function formatValue(value: Value) {
  const json = convexToJson(value);
  if (process.stdout.isTTY) {
    // TODO (Tom) add JSON syntax highlighting like https://stackoverflow.com/a/51319962/398212
    // until then, just spit out something that isn't quite JSON because it's easy
    return util.inspect(value, { colors: true, depth: null });
  } else {
    return JSON.stringify(json, null, 2);
  }
}

export async function subscribeAndLog(
  ctx: Context,
  deploymentUrl: string,
  adminKey: string,
  functionName: string,
  args: Record<string, Value>
) {
  return subscribe(
    ctx,
    deploymentUrl,
    adminKey,
    functionName,
    args,
    "indefinitely",
    {
      onStart() {
        logFinishedStep(
          ctx,
          `Watching query ${functionName} on ${deploymentUrl}...`
        );
      },
      onChange(client) {
        logOutput(
          ctx,
          formatValue(client.localQueryResult(functionName, args)!)
        );
      },
      onStop() {
        logMessage(ctx, `Closing connection to ${deploymentUrl}...`);
      },
    }
  );
}

export async function subscribe(
  ctx: Context,
  deploymentUrl: string,
  adminKey: string,
  functionName: string,
  args: Record<string, Value>,
  until: "first change" | "indefinitely",
  callbacks?: {
    onStart?: (client: BaseConvexClient) => void;
    onChange?: (client: BaseConvexClient) => void;
    onStop?: () => void;
  }
) {
  let changes = 0;
  const client = new BaseConvexClient(
    deploymentUrl,
    (updatedQueries) => {
      // First bump is just the initial results reporting
      for (const _ of updatedQueries) {
        changes++;
        callbacks?.onChange?.(client);
        if (until === "first change" && changes > 1) {
          stopWatching();
        }
      }
    },
    {
      // pretend that a Node.js 'ws' library WebSocket is a browser WebSocket
      webSocketConstructor: ws as unknown as typeof WebSocket,
      unsavedChangesWarning: false,
    }
  );
  client.setAdminAuth(adminKey);
  const { unsubscribe } = client.subscribe(functionName, args);

  callbacks?.onStart?.(client);

  let done = false;
  let onDone: (v: unknown) => void;
  const stopWatching = () => {
    unsubscribe();
    void client.close();
    process.off("SIGINT", sigintListener);
    done = true;
    onDone(null);
  };
  const doneP = new Promise((resolve) => (onDone = resolve));
  function sigintListener() {
    stopWatching();
  }
  process.on("SIGINT", sigintListener);
  while (!done) {
    // loops once per day (any large value < 2**31 would work)
    const oneDay = 24 * 60 * 60 * 1000;
    await Promise.race([
      doneP,
      new Promise((resolve) => setTimeout(resolve, oneDay)),
    ]);
  }
}
