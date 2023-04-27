import { useMemo, useState } from "react";

import { GenericAPI, NamedQuery } from "../api/index.js";
import {
  ConvexFunction,
  OptimisticLocalStore,
  PublicQueryNames,
} from "../browser/index.js";
import { PaginationOptions, PaginationResult } from "../server/index.js";
import { BetterOmit, Expand } from "../type_utils.js";
import { convexToJson, Value } from "../values/index.js";
import { RequestForQueries, useQueriesGeneric } from "./use_queries.js";

/**
 * Load data reactively from a paginated query to a create a growing list.
 *
 * This can be used to power "infinite scroll" UIs.
 *
 * This hook must be used with Convex query functions that match
 * {@link PaginatedQueryFunction}. This means they must:
 * 1. Have a single arguments object with a `paginationOpts` property
 * of type {@link server.PaginationOptions}.
 * 2. Return a {@link server.PaginationResult}.
 *
 * `usePaginatedQueryGeneric` concatenates all the pages
 * of results into a single list and manages the continuation cursors when
 * requesting more items.
 *
 * Example usage:
 * ```typescript
 * const { results, status, loadMore } = usePaginatedQueryGeneric(
 *   "listMessages",
 *   { channel: "#general" },
 *   { initialNumItems: 5 }
 * );
 * ```
 *
 * If the query `name` or `args` change, the pagination state will be reset
 * to the first page. Similarly, if any of the pages result in an InvalidCursor
 * or QueryScannedTooManyDocuments error, the pagination state will also reset
 * to the first page.
 *
 * To learn more about pagination, see [Paginated Queries](https://docs.convex.dev/database/pagination).
 *
 * If you're using code generation, use the `usePaginatedQuery` function in
 * `convex/_generated/react.js` which is typed for your API.
 *
 * @param name - The name of the query function.
 * @param args - The arguments object for the query function, excluding
 * the `paginationOpts` property. That property is injected by this hook.
 * @param options - An object specifying the `initialNumItems` to be loaded in
 * the first page.
 * @returns A {@link UsePaginatedQueryResult} that includes the currently loaded
 * items, the status of the pagination, and a `loadMore` function.
 *
 * @public
 */
export function usePaginatedQueryGeneric(
  name: string,
  args: Record<string, Value>,
  options: { initialNumItems: number }
): UsePaginatedQueryResult<any> {
  if (
    typeof options?.initialNumItems !== "number" ||
    options.initialNumItems < 0
  ) {
    throw new Error(
      `\`options.initialNumItems\` must be a positive number. Received \`${options?.initialNumItems}\`.`
    );
  }

  const createInitialState = useMemo(() => {
    return () => {
      const id = nextPaginationId();
      return {
        name,
        args,
        id,
        maxQueryIndex: 0,
        queries: {
          0: {
            name,
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
  }, [JSON.stringify(convexToJson(args)), name, options.initialNumItems]);

  const [state, setState] = useState<{
    name: string;
    args: Record<string, Value>;
    id: number;
    maxQueryIndex: number;
    queries: RequestForQueries;
  }>(createInitialState);

  // `currState` is the state that we'll render based on.
  let currState = state;
  if (
    name !== state.name ||
    JSON.stringify(convexToJson(args)) !==
      JSON.stringify(convexToJson(state.args))
  ) {
    currState = createInitialState();
    setState(currState);
  }

  const resultsObject = useQueriesGeneric(currState.queries);

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
          currResult.message.includes("QueryScannedTooManyDocuments") ||
          currResult.message.includes("ArrayTooLong")
        ) {
          // `usePaginatedQueryGeneric` handles a few types of query errors:

          // 1. InvalidCursor: If the cursor is invalid, probably the paginated
          // database query was data-dependent and changed underneath us. The
          // cursor in the params or journal no longer matches the current
          // database query.
          // 2. QueryScannedTooManyDocuments: Likely so many elements were
          // added to a single page they hit our limit.
          // 3. Array length is too long: Likely so many elements were added
          // to a single page they hit our limit.

          // In both cases we want to restart pagination to throw away all our
          // existing cursors.
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

  const statusAndLoadMore = useMemo(() => {
    if (maybeLastResult === undefined) {
      return {
        status: "LoadingMore",
        loadMore: undefined,
      } as const;
    }
    if (maybeLastResult.isDone) {
      return {
        status: "Exhausted",
        loadMore: undefined,
      } as const;
    }
    const continueCursor = maybeLastResult.continueCursor;
    let alreadyLoadingMore = false;
    return {
      status: "CanLoadMore",
      loadMore: (numItems: number) => {
        if (!alreadyLoadingMore) {
          alreadyLoadingMore = true;
          setState(prevState => {
            const maxQueryIndex = prevState.maxQueryIndex + 1;
            const queries = { ...prevState.queries };
            queries[maxQueryIndex] = {
              name: prevState.name,
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
  }, [maybeLastResult]);

  return {
    results,
    ...statusAndLoadMore,
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
 * 1. `results` - An array of the currently loaded results.
 * 2. `status` - The status of the pagination. The possible statuses are:
 *   - "CanLoadMore": This query may have more items to fetch. Call `loadMore` to
 *   fetch another page.
 *   - "LoadingMore": We're currently loading another page of results.
 *   - "Exhausted": We've paginated to the end of the list.
 * 3. `loadMore` A callback to fetch more results. This will be `undefined`
 * unless the status is "CanLoadMore".
 *
 * @public
 */
export type UsePaginatedQueryResult<T> = {
  results: T[];
} & (
  | {
      status: "CanLoadMore";
      loadMore: (numItems: number) => void;
    }
  | {
      status: "LoadingMore";
      loadMore: undefined;
    }
  | {
      status: "Exhausted";
      loadMore: undefined;
    }
);

/**
 * A query function that is usable with {@link usePaginatedQueryGeneric}.
 *
 * The function's argument must be an object with a
 * `paginationOpts` property of type {@link server.PaginationOptions}.
 *
 * The function must return a {@link server.PaginationResult}.
 *
 * @public
 */
export type PaginatedQueryFunction<Args extends object, ReturnType> = (
  args: {
    paginationOpts: PaginationOptions;
  } & Args
) => PaginationResult<ReturnType>;

/**
 * Test whether a function matches the signature of {@link PaginatedQueryFunction}.
 */
type IsPaginatedQueryFunction<Func extends ConvexFunction> =
  Parameters<Func> extends [
    args: {
      paginationOpts: PaginationOptions;
    }
  ]
    ? ReturnType<Func> extends PaginationResult<any>
      ? true
      : false
    : false;

/**
 * The names of the paginated query functions in a Convex API.
 *
 * These are normal query functions that match {@link PaginatedQueryFunction}.
 *
 * @public
 */
export type PaginatedQueryNames<API extends GenericAPI> = {
  [QueryName in PublicQueryNames<API>]: IsPaginatedQueryFunction<
    NamedQuery<API, QueryName>
  > extends true
    ? QueryName
    : never;
}[PublicQueryNames<API>];

/**
 * The type of the arguments to a {@link PaginatedQueryFunction}.
 *
 * This type includes the entire arguments object except the `paginationOpts`
 * property.
 *
 * @public
 */
export type PaginatedQueryArgs<Query extends PaginatedQueryFunction<any, any>> =
  Expand<BetterOmit<Parameters<Query>[0], "paginationOpts">>;

/**
 * The return type of a {@link PaginatedQueryFunction}.
 *
 * This is the type of the inner document or object within the
 * {@link server.PaginationResult} that a paginated query function returns.
 *
 * @public
 */
export type PaginatedQueryReturnType<
  Query extends PaginatedQueryFunction<any, any>
> = Query extends PaginatedQueryFunction<any, infer ReturnType>
  ? ReturnType
  : never;

/**
 * Internal type helper used by Convex code generation.
 *
 * Used to give {@link usePaginatedQueryGeneric} a type specific to your API.
 *
 * @public
 */
export type UsePaginatedQueryForAPI<API extends GenericAPI> = <
  Name extends PaginatedQueryNames<API>
>(
  name: Name,
  args: PaginatedQueryArgs<NamedQuery<API, Name>>,
  options: { initialNumItems: number }
) => UsePaginatedQueryResult<PaginatedQueryReturnType<NamedQuery<API, Name>>>;

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
 * const myMutation = useMutation("myMutationName")
 * .withOptimisticUpdate((localStore, mutationArg) => {
 *
 *   // Optimistically update the document with ID `mutationArg`
 *   // to have an additional property.
 *
 *   optimisticallyUpdateValueInPaginatedQuery(
 *     localStore,
 *     "paginatedQueryName",
 *     {},
 *     currentValue => {
 *       if (mutationArg.equals(currentValue._id)) {
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
 * @param name - The name of the paginated query function.
 * @param args - The arguments object to the query function, excluding the
 * `paginationOpts` property.
 * @param updateValue - A function to produce the new values.
 *
 * @public
 */
export function optimisticallyUpdateValueInPaginatedQuery<
  API extends GenericAPI,
  Name extends PaginatedQueryNames<API>
>(
  localStore: OptimisticLocalStore<API>,
  name: Name,
  args: PaginatedQueryArgs<NamedQuery<API, Name>>,
  updateValue: (
    currentValue: PaginatedQueryReturnType<NamedQuery<API, Name>>
  ) => PaginatedQueryReturnType<NamedQuery<API, Name>>
): void {
  // TODO: This should really be sorted JSON or an `equals` method
  // so that the order of properties in sets, maps, and objects doesn't break
  // our comparison.
  const expectedArgs = JSON.stringify(convexToJson(args as Value));

  for (const query of localStore.getAllQueries(name)) {
    if (query.value !== undefined) {
      const { paginationOpts: _, ...innerArgs } = query.args as {
        paginationOpts: PaginationOptions;
      };
      if (JSON.stringify(convexToJson(innerArgs as Value)) === expectedArgs) {
        const value = query.value;
        if (
          typeof value === "object" &&
          value !== null &&
          Array.isArray(value.page)
        ) {
          localStore.setQuery(name, query.args, {
            ...value,
            page: value.page.map(updateValue),
          });
        }
      }
    }
  }
}
