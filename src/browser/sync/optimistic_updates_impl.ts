import { parseArgs } from "../../common/index.js";
import { Value } from "../../values/index.js";
import { createError } from "../logging.js";
import { FunctionResult } from "./function_result.js";
import { OptimisticLocalStore } from "./optimistic_updates.js";
import { RequestId } from "./protocol.js";
import {
  canonicalizeUdfPath,
  QueryToken,
  serializePathAndArgs,
} from "./udf_path_utils.js";

/**
 * An optimistic update function that has been curried over its arguments.
 */
type WrappedOptimisticUpdate = (locaQueryStore: OptimisticLocalStore) => void;

/**
 * The implementation of `OptimisticLocalStore`.
 *
 * This class provides the interface for optimistic updates to modify query results.
 */
class OptimisticLocalStoreImpl implements OptimisticLocalStore {
  // A references of the query results in OptimisticQueryResults
  private readonly queryResults: QueryResultsMap;

  // All of the queries modified by this class
  readonly modifiedQueries: QueryToken[];

  constructor(queryResults: QueryResultsMap) {
    this.queryResults = queryResults;
    this.modifiedQueries = [];
  }

  getQuery(name: string, args?: Record<string, Value>): Value | undefined {
    const queryArgs = parseArgs(args);
    const query = this.queryResults.get(serializePathAndArgs(name, queryArgs));
    if (query === undefined) {
      return undefined;
    }
    return OptimisticLocalStoreImpl.queryValue(query.result);
  }

  getAllQueries(
    name: string
  ): { args: Record<string, Value>; value: Value | undefined }[] {
    const queriesWithName = [];
    for (const query of this.queryResults.values()) {
      if (query.udfPath === canonicalizeUdfPath(name)) {
        queriesWithName.push({
          args: query.args,
          value: OptimisticLocalStoreImpl.queryValue(query.result),
        });
      }
    }
    return queriesWithName;
  }

  setQuery(
    name: string,
    args: Record<string, Value>,
    value: Value | undefined
  ): void {
    const queryToken = serializePathAndArgs(name, args);

    let result: FunctionResult | undefined;
    if (value === undefined) {
      result = undefined;
    } else {
      result = {
        success: true,
        value,
        // It's an optimistic update, so there are no function logs to show.
        logLines: [],
      };
    }
    const query: Query = {
      udfPath: name,
      args,
      result,
    };
    this.queryResults.set(queryToken, query);
    this.modifiedQueries.push(queryToken);
  }

  private static queryValue(
    result: FunctionResult | undefined
  ): Value | undefined {
    if (result === undefined) {
      return undefined;
    } else if (result.success) {
      return result.value;
    } else {
      // If the query is an error state, just return `undefined` as though
      // it's loading. Optimistic updates should already handle `undefined` well
      // and there isn't a need to break the whole update because it tried
      // to load a single query that errored.
      return undefined;
    }
  }
}

type OptimisticUpdateAndId = {
  update: WrappedOptimisticUpdate;
  mutationId: RequestId;
};

type Query = {
  // undefined means the query was set to be loading (undefined) in an optimistic update.
  // Note that we can also have queries not present in the QueryResultMap
  // at all because they are still loading from the server.
  result: FunctionResult | undefined;
  udfPath: string;
  args: Record<string, Value>;
};
export type QueryResultsMap = Map<QueryToken, Query>;

type ChangedQueries = QueryToken[];

/**
 * A view of all of our query results with optimistic updates applied on top.
 */
export class OptimisticQueryResults {
  private queryResults: QueryResultsMap;
  private optimisticUpdates: OptimisticUpdateAndId[];

  constructor() {
    this.queryResults = new Map();
    this.optimisticUpdates = [];
  }

  ingestQueryResultsFromServer(
    serverQueryResults: QueryResultsMap,
    optimisticUpdatesToDrop: Set<RequestId>
  ): ChangedQueries {
    this.optimisticUpdates = this.optimisticUpdates.filter(updateAndId => {
      return !optimisticUpdatesToDrop.has(updateAndId.mutationId);
    });

    const oldQueryResults = this.queryResults;
    this.queryResults = new Map(serverQueryResults);
    const localStore = new OptimisticLocalStoreImpl(this.queryResults);
    for (const updateAndId of this.optimisticUpdates) {
      updateAndId.update(localStore);
    }

    // To find the changed queries, just do a shallow comparison
    // TODO(CX-733): Change this so we avoid unnecessary rerenders
    const changedQueries: ChangedQueries = [];
    for (const [queryToken, query] of this.queryResults) {
      const oldQuery = oldQueryResults.get(queryToken);
      if (oldQuery === undefined || oldQuery.result !== query.result) {
        changedQueries.push(queryToken);
      }
    }

    return changedQueries;
  }

  applyOptimisticUpdate(
    update: WrappedOptimisticUpdate,
    mutationId: RequestId
  ): ChangedQueries {
    // Apply the update to our store
    this.optimisticUpdates.push({
      update,
      mutationId,
    });
    const localStore = new OptimisticLocalStoreImpl(this.queryResults);
    update(localStore);

    // Notify about any query results that changed
    // TODO(CX-733): Change this so we avoid unnecessary rerenders
    return localStore.modifiedQueries;
  }

  queryResult(queryToken: QueryToken): Value | undefined {
    const query = this.queryResults.get(queryToken);
    if (query === undefined) {
      return undefined;
    }
    const result = query.result;
    if (result === undefined) {
      return undefined;
    } else if (result.success) {
      return result.value;
    } else {
      throw createError("query", query.udfPath, result.errorMessage);
    }
  }

  /**
   * @internal
   */
  queryLogs(queryToken: QueryToken): string[] | undefined {
    const query = this.queryResults.get(queryToken);
    return query?.result?.logLines;
  }
}
