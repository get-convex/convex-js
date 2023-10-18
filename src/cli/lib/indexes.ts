import { AxiosResponse } from "axios";
import chalk from "chalk";
import path from "path";
import { bundleSchema } from "../../bundler/index.js";
import { version } from "../version.js";
import {
  Context,
  changeSpinner,
  logFailure,
  logFinishedStep,
  logError,
} from "../../bundler/context.js";
import {
  poll,
  logAndHandleAxiosError,
  deprecationCheckWarning,
  deploymentClient,
} from "./utils.js";

type IndexMetadata = {
  table: string;
  name: string;
  fields:
    | string[]
    | {
        searchField: string;
        filterFields: string[];
      };
  backfill: {
    state: "in_progress" | "done";
  };
};

type SchemaState =
  | { state: "pending" }
  | { state: "validated" }
  | { state: "active" }
  | { state: "overwritten" }
  | { state: "failed"; error: string; tableName?: string };

type SchemaStateResponse = {
  indexes: IndexMetadata[];
  schemaState: SchemaState;
};
type PrepareSchemaResponse = {
  added: IndexMetadata[];
  dropped: IndexMetadata[];
  schemaId: string;
};

export async function pushSchema(
  ctx: Context,
  origin: string,
  adminKey: string,
  schemaDir: string,
  dryRun: boolean
): Promise<{ schemaId?: string; schemaState?: SchemaState }> {
  if (!ctx.fs.exists(path.resolve(schemaDir, "schema.ts"))) {
    // Don't do anything.
    return {};
  }
  const bundles = await bundleSchema(ctx, schemaDir);

  changeSpinner(ctx, "Checking for index or schema changes...");

  let data: PrepareSchemaResponse;
  const client = deploymentClient(origin);
  try {
    const res = await client.post<PrepareSchemaResponse>(
      "/api/prepare_schema",
      {
        bundle: bundles[0],
        adminKey,
        dryRun,
      },
      {
        headers: {
          "Convex-Client": `npm-cli-${version}`,
        },
      }
    );
    deprecationCheckWarning(ctx, res);
    data = res.data;
  } catch (err) {
    logFailure(ctx, `Error: Unable to run schema validation on ${origin}`);
    return await logAndHandleAxiosError(ctx, err);
  }

  const schemaId = data.schemaId;

  changeSpinner(
    ctx,
    "Backfilling indexes and checking that documents match your schema..."
  );
  const schemaState = await waitForReadySchema(ctx, origin, adminKey, schemaId);
  logIndexChanges(ctx, data, dryRun);
  return { schemaId, schemaState };
}

/// Wait for indexes to build and schema to be validated.
async function waitForReadySchema(
  ctx: Context,
  origin: string,
  adminKey: string,
  schemaId: string
): Promise<SchemaState> {
  const path = `/api/schema_state/${schemaId}`;
  const client = deploymentClient(origin);
  const fetch = async () => {
    try {
      return await client.get<SchemaStateResponse>(path, {
        headers: {
          Authorization: `Convex ${adminKey}`,
          "Convex-Client": `npm-cli-${version}`,
        },
        data: { schemaId },
      });
    } catch (err) {
      logFailure(
        ctx,
        `Error: Unable to build indexes and run schema validation on ${origin}`
      );
      return await logAndHandleAxiosError(ctx, err);
    }
  };
  const validate = (result: AxiosResponse<SchemaStateResponse, any>) =>
    result.data.indexes.every((index) => index.backfill.state === "done") &&
    result.data.schemaState.state !== "pending";
  const result = await poll(fetch, validate);
  switch (result.data.schemaState.state) {
    case "failed":
      // Schema validation failed. This could be either because the data
      // is bad or the schema is wrong. Classify this as a filesystem error
      // because adjusting `schema.ts` is the most normal next step.
      logFailure(ctx, "Schema validation failed");
      logError(ctx, chalk.red(`${result.data.schemaState.error}`));
      return await ctx.crash(1, {
        "invalid filesystem or db data":
          result.data.schemaState.tableName ?? null,
      });

    case "overwritten":
      logFailure(ctx, `Schema was overwritten by another push.`);
      return await ctx.crash(1, "fatal");
    case "validated":
      logFinishedStep(ctx, "Schema validation complete.");
      break;
    case "active":
      break;
  }
  return result.data.schemaState;
}

function logIndexChanges(
  ctx: Context,
  indexes: {
    added: IndexMetadata[];
    dropped: IndexMetadata[];
  },
  dryRun: boolean
) {
  if (indexes.dropped.length > 0) {
    let indexDiff = "";
    for (const index of indexes.dropped) {
      indexDiff += `  [-] ${stringifyIndex(index)}\n`;
    }
    // strip last new line
    indexDiff = indexDiff.slice(0, -1);
    logFinishedStep(
      ctx,
      `${dryRun ? "Would delete" : "Deleted"} table indexes:\n${indexDiff}`
    );
  }
  if (indexes.added.length > 0) {
    let indexDiff = "";
    for (const index of indexes.added) {
      indexDiff += `  [+] ${stringifyIndex(index)}\n`;
    }
    // strip last new line
    indexDiff = indexDiff.slice(0, -1);
    logFinishedStep(
      ctx,
      `${dryRun ? "Would add" : "Added"} table indexes:\n${indexDiff}`
    );
  }
}

function stringifyIndex(index: IndexMetadata) {
  return `${index.table}.${index.name} ${JSON.stringify(index.fields)}`;
}
