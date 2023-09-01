import { useMemo, useState } from "react";

import { OptimisticLocalStore } from "../browser/index.js";
import {
  FunctionReturnType,
  PaginationOptions,
  paginationOptsValidator,
  PaginationResult,
} from "../server/index.js";
import { convexToJson, Infer, Value } from "../values/index.js";
import { useQueries } from "./use_queries.js";
import {
  FunctionArgs,
  FunctionReference,
  getFunctionName,
} from "../server/api.js";
import { BetterOmit, Expand } from "../type_utils.js";

/**
 * A {@link server.FunctionReference} that is usable with {@link usePaginatedQuery}.
 *
 * This function reference must:
 * - Refer to a public query
 * - Have an argument named "paginationOpts" of type {@link server.PaginationOptions}
 * - Have a return type of {@link server.PaginationResult}.
 *
 * @public
 */
export type PaginatedQueryReference = FunctionReference<
  "query",
  "public",
  { paginationOpts: PaginationOptions },
  PaginationResult<any>
>;

/**
 * Load data reactively from a paginated query to a create a growing list.
 *
 * This can be used to power "infinite scroll" UIs.
 *
 * This hook must be used with public query references that match
 * {@link PaginatedQueryReference}.
 *
 * `usePaginatedQuery` concatenates all the pages of results into a single list
 * and manages the continuation cursors when requesting more items.
 *
 * Example usage:
 * ```typescript
 * const { results, status, isLoading, loadMore } = usePaginatedQuery(
 *   api.messages.list,
 *   { channel: "#general" },
 *   { initialNumItems: 5 }
 * );
 * ```
 *
 * If the query reference or arguments change, the pagination state will be reset
 * to the first page. Similarly, if any of the pages result in an InvalidCursor
 * error or an error associated with too much data, the pagination state will also
 * reset to the first page.
 *
 * To learn more about pagination, see [Paginated Queries](https://docs.convex.dev/database/pagination).
 *
 * @param query - A FunctionReference to the public query function to run.
 * @param args - The arguments object for the query function, excluding
 * the `paginationOpts` property. That property is injected by this hook.
 * @param options - An object specifying the `initialNumItems` to be loaded in
 * the first page.
 * @returns A {@link UsePaginatedQueryResult} that includes the currently loaded
 * items, the status of the pagination, and a `loadMore` function.
 *
 * @public
 */
export function usePaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  args: PaginatedQueryArgs<Query>,
  options: { initialNumItems: number }
): UsePaginatedQueryReturnType<Query> {
  if (
    typeof options?.initialNumItems !== "number" ||
    options.initialNumItems < 0
  ) {
    throw new Error(
      `\`options.initialNumItems\` must be a positive number. Received \`${options?.initialNumItems}\`.`
    );
  }
  const queryName = getFunctionName(query);
  const createInitialState = useMemo(() => {
    return () => {
      const id = nextPaginationId();
      return {
        query,
        args: args as Record<string, Value>,
        id,
        maxQueryIndex: 0,
        queries: {
          0: {
            query,
            args: {
              ...args,
              paginationOpts: {
                numItems: options.initialNumItems,
                cursor: null,
                id,
              },
            },
          },
        },
      };
    };
    // ESLint doesn't like that we're stringifying the args. We do this because
    // we want to avoid rerendering if the args are a different
    // object that serializes to the same result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(convexToJson(args as Value)),
    queryName,
    options.initialNumItems,
  ]);

  const [state, setState] = useState<{
    query: FunctionReference<"query">;
    args: Record<string, Value>;
    id: number;
    maxQueryIndex: number;
    queries: Record<
      number,
      {
        query: FunctionReference<"query">;
        // Use the validator type as a test that it matches the args
        // we generate.
        args: { paginationOpts: Infer<typeof paginationOptsValidator> };
      }
    >;
  }>(createInitialState);

  // `currState` is the state that we'll render based on.
  let currState = state;
  if (
    getFunctionName(query) !== getFunctionName(state.query) ||
    JSON.stringify(convexToJson(args as Value)) !==
      JSON.stringify(convexToJson(state.args))
  ) {
    currState = createInitialState();
    setState(currState);
  }

  const resultsObject = useQueries(currState.queries);

  const [results, maybeLastResult]: [
    Value[],
    undefined | PaginationResult<Value>
  ] = useMemo(() => {
    let currResult = undefined;

    const allItems = [];
    for (let i = 0; i <= currState.maxQueryIndex; i++) {
      currResult = resultsObject[i];
      if (currResult === undefined) {
        break;
      }

      if (currResult instanceof Error) {
        if (
          currResult.message.includes("InvalidCursor") ||
          currResult.message.includes("ArrayTooLong") ||
          currResult.message.includes("TooManyReads") ||
          currResult.message.includes("TooManyDocumentsRead") ||
          currResult.message.includes("ReadsTooLarge")
        ) {
          // `usePaginatedQueryGeneric` handles a few types of query errors:

          // - InvalidCursor: If the cursor is invalid, probably the paginated
          // database query was data-dependent and changed underneath us. The
          // cursor in the params or journal no longer matches the current
          // database query.
          // - ArrayTooLong, TooManyReads, TooManyDocumentsRead, ReadsTooLarge:
          // Likely so many elements were added to a single page they hit our limit.

          // In all cases, we want to restart pagination to throw away all our
          // existing cursors.
          console.warn(
            "usePaginatedQuery hit error, resetting pagination state: " +
              currResult.message
          );
          setState(createInitialState);
          return [[], undefined];
        } else {
          throw currResult;
        }
      }
      allItems.push(...currResult.page);
    }
    return [allItems, currResult];
  }, [resultsObject, currState.maxQueryIndex, createInitialState]);

  const statusObject = useMemo(() => {
    if (maybeLastResult === undefined) {
      if (currState.maxQueryIndex === 0) {
        return {
          status: "LoadingFirstPage",
          isLoading: true,
          loadMore: (_numItems: number) => {
            // Intentional noop.
          },
        } as const;
      } else {
        return {
          status: "LoadingMore",
          isLoading: true,
          loadMore: (_numItems: number) => {
            // Intentional noop.
          },
        } as const;
      }
    }
    if (maybeLastResult.isDone) {
      return {
        status: "Exhausted",
        isLoading: false,
        loadMore: (_numItems: number) => {
          // Intentional noop.
        },
      } as const;
    }
    const continueCursor = maybeLastResult.continueCursor;
    let alreadyLoadingMore = false;
    return {
      status: "CanLoadMore",
      isLoading: false,
      loadMore: (numItems: number) => {
        if (!alreadyLoadingMore) {
          alreadyLoadingMore = true;
          setState((prevState) => {
            const maxQueryIndex = prevState.maxQueryIndex + 1;
            const queries = { ...prevState.queries };
            queries[maxQueryIndex] = {
              query: prevState.query,
              args: {
                ...prevState.args,
                paginationOpts: {
                  numItems,
                  cursor: continueCursor,
                  id: prevState.id,
                },
              },
            };
            return {
              ...prevState,
              maxQueryIndex,
              queries,
            };
          });
        }
      },
    } as const;
  }, [maybeLastResult, currState.maxQueryIndex]);

  return {
    results,
    ...statusObject,
  };
}

let paginationId = 0;
/**
 * Generate a new, unique ID for a pagination session.
 *
 * Every usage of {@link usePaginatedQueryGeneric} puts a unique ID into the
 * query function arguments as a "cache-buster". This serves two purposes:
 *
 * 1. All calls to {@link usePaginatedQueryGeneric} have independent query
 * journals.
 *
 * Every time we start a new pagination session, we'll load the first page of
 * results and receive a fresh journal. Without the ID, we might instead reuse
 * a query subscription already present in our client. This isn't desirable
 * because the existing query function result may have grown or shrunk from the
 * requested `initialNumItems`.
 *
 * 2. We can restart the pagination session on some types of errors.
 *
 * Sometimes we want to restart pagination from the beginning if we hit an error.
 * Similar to (1), we'd like to ensure that this new session actually requests
 * its first page from the server and doesn't reuse a query result already
 * present in the client that may have hit the error.
 *
 * @returns The pagination ID.
 */
function nextPaginationId(): number {
  paginationId++;
  return paginationId;
}

/**
 * The result of calling the {@link usePaginatedQueryGeneric} hook.
 *
 * This includes:
 * - `results` - An array of the currently loaded results.
 * - `isLoading` - Whether the hook is currently loading results.
 * - `status` - The status of the pagination. The possible statuses are:
 *   - "LoadingFirstPage": The hook is loading the first page of results.
 *   - "CanLoadMore": This query may have more items to fetch. Call `loadMore` to
 *   fetch another page.
 *   - "LoadingMore": We're currently loading another page of results.
 *   - "Exhausted": We've paginated to the end of the list.
 * - `loadMore(n)` A callback to fetch more results. This will only fetch more
 * results if the status is "CanLoadMore".
 *
 * @public
 */
export type UsePaginatedQueryResult<Item> = {
  results: Item[];
  loadMore: (numItems: number) => void;
} & (
  | {
      status: "LoadingFirstPage";
      isLoading: true;
    }
  | {
      status: "CanLoadMore";
      isLoading: false;
    }
  | {
      status: "LoadingMore";
      isLoading: true;
    }
  | {
      status: "Exhausted";
      isLoading: false;
    }
);

/**
 * The possible pagination statuses in {@link UsePaginatedQueryResult}.
 *
 * This is a union of string literal types.
 * @public
 */
export type PaginationStatus = UsePaginatedQueryResult<any>["status"];

/**
 * Given a {@link PaginatedQueryReference}, get the type of the arguments
 * object for the query, excluding the `paginationOpts` argument.
 *
 * @public
 */
export type PaginatedQueryArgs<Query extends PaginatedQueryReference> = Expand<
  BetterOmit<FunctionArgs<Query>, "paginationOpts">
>;

/**
 * Given a {@link PaginatedQueryReference}, get the type of the item being
 * paginated over.
 * @public
 */
export type PaginatedQueryItem<Query extends PaginatedQueryReference> =
  FunctionReturnType<Query>["page"][number];

/**
 * The return type of {@link usePaginatedQuery}.
 *
 * @public
 */
export type UsePaginatedQueryReturnType<Query extends PaginatedQueryReference> =
  UsePaginatedQueryResult<PaginatedQueryItem<Query>>;

/**
 * Optimistically update the values in a paginated list.
 *
 * This optimistic update is designed to be used to update data loaded with
 * {@link usePaginatedQueryGeneric}. It updates the list by applying
 * `updateValue` to each element of the list across all of the loaded pages.
 *
 * This will only apply to queries with a matching names and arguments.
 *
 * Example usage:
 * ```ts
 * const myMutation = useMutation(api.myModule.myMutation)
 * .withOptimisticUpdate((localStore, mutationArg) => {
 *
 *   // Optimistically update the document with ID `mutationArg`
 *   // to have an additional property.
 *
 *   optimisticallyUpdateValueInPaginatedQuery(
 *     localStore,
 *     api.myModule.paginatedQuery
 *     {},
 *     currentValue => {
 *       if (mutationArg === currentValue._id) {
 *         return {
 *           ...currentValue,
 *           "newProperty": "newValue",
 *         };
 *       }
 *       return currentValue;
 *     }
 *   );
 *
 * });
 * ```
 *
 * @param localStore - An {@link OptimisticLocalStore} to update.
 * @param query - A {@link FunctionReference} for the paginated query to update.
 * @param args - The arguments object to the query function, excluding the
 * `paginationOpts` property.
 * @param updateValue - A function to produce the new values.
 *
 * @public
 */
export function optimisticallyUpdateValueInPaginatedQuery<
  Query extends PaginatedQueryReference
>(
  localStore: OptimisticLocalStore,
  query: Query,
  args: PaginatedQueryArgs<Query>,
  updateValue: (
    currentValue: PaginatedQueryItem<Query>
  ) => PaginatedQueryItem<Query>
): void {
  // TODO: This should really be sorted JSON or an `equals` method
  // so that the order of properties in sets, maps, and objects doesn't break
  // our comparison.
  const expectedArgs = JSON.stringify(convexToJson(args as Value));

  for (const queryResult of localStore.getAllQueries(query)) {
    if (queryResult.value !== undefined) {
      const { paginationOpts: _, ...innerArgs } = queryResult.args as {
        paginationOpts: PaginationOptions;
      };
      if (JSON.stringify(convexToJson(innerArgs as Value)) === expectedArgs) {
        const value = queryResult.value;
        if (
          typeof value === "object" &&
          value !== null &&
          Array.isArray(value.page)
        ) {
          localStore.setQuery(query, queryResult.args, {
            ...value,
            page: value.page.map(updateValue),
          });
        }
      }
    }
  }
}
