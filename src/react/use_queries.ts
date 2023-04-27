import { Value } from "../values/index.js";
import { useEffect, useMemo, useState } from "react";
import { useConvexGeneric } from "./client.js";
import { GenericAPI, NamedQuery, PublicQueryNames } from "../api/index.js";
import { CreateWatch, QueriesObserver } from "./queries_observer.js";
import { useSubscription } from "./use_subscription.js";
import { ArgsObject, QueryJournal } from "../browser/index.js";

/**
 * Load a variable number of reactive Convex queries.
 *
 * `useQueriesGeneric` is similar to {@link useQueryGeneric} but it allows
 * loading multiple queries which can be useful for loading a dynamic number
 * of queries without violating the rules of React hooks.
 *
 * This hook accepts an object whose keys are identifiers for each query and the
 * values are objects of `{ name: string, args: Record<string, Value> }`. The
 * `name` is the name of the Convex query function to load, and the `args` are
 * the arguments to that function.
 *
 * The hook returns an object that maps each identifier to the result of the query,
 * `undefined` if the query is still loading, or an instance of `Error` if the query
 * threw an exception.
 *
 * For example if you loaded a query like:
 * ```typescript
 * const results = useQueriesGeneric({
 *   messagesInGeneral: {
 *     name: "listMessages",
 *     args: { channel: "#general" }
 *   }
 * });
 * ```
 * then the result would look like:
 * ```typescript
 * {
 *   messagesInGeneral: [{
 *     channel: "#general",
 *     body: "hello"
 *     _id: ...,
 *     _creationTime: ...
 *   }]
 * }
 * ```
 *
 * This React hook contains internal state that will cause a rerender
 * whenever any of the query results change.
 *
 * Throws an error if not used under {@link ConvexProvider}.
 *
 * If you're using code generation, use the `useQueries` function in
 * `convex/_generated/react.js` which is typed for your API.
 *
 * @param queries - An object mapping identifiers to objects of
 * `{name: string, args: Record<string, Value> }` describing which query
 * functions to fetch.
 * @returns An object with the same keys as the input. The values are the result
 * of the query function, `undefined` if it's still loading, or an `Error` if
 * it threw an exception.
 *
 * @public
 */
export function useQueriesGeneric(
  queries: RequestForQueries
): Record<string, any | undefined | Error> {
  const convex = useConvexGeneric();
  if (convex === undefined) {
    throw new Error(
      "Could not find Convex client! `useQueries` must be used in the React component " +
        "tree under `ConvexProvider`. Did you forget it? " +
        "See https://docs.convex.dev/quick-start#set-up-convex-in-your-react-app"
    );
  }
  const createWatch = useMemo(() => {
    return (
      name: string,
      args: Record<string, Value>,
      journal?: QueryJournal
    ) => {
      return convex.watchQuery(name, args, { journal });
    };
  }, [convex]);
  return useQueriesHelper(queries, createWatch);
}

/**
 * Internal version of `useQueriesGeneric` that is exported for testing.
 */
export function useQueriesHelper(
  queries: RequestForQueries,
  createWatch: CreateWatch
): Record<string, any | undefined | Error> {
  const [observer] = useState(() => new QueriesObserver(createWatch));
  const [effectRan, setEffectRan] = useState(false);

  if (observer.createWatch !== createWatch) {
    observer.setCreateWatch(createWatch);
  }

  // Unsubscribe from all queries on unmount.
  useEffect(() => {
    setEffectRan(true);
    return () => {
      observer.destroy();
    };
  }, [observer]);

  const subscription = useMemo(() => {
    // Any time the queries change, update our observer.
    // Correctness notes:
    // 1. `observer.setQueries` could subscribe us to new queries. They are
    // cleaned up in `observer.destroy()`, but that may never get called!
    // React may render a component and then throw it out without running
    // the effects or their destructors. For satefy, we should only subscribe
    // if the effects have run and the destructor has been configured.
    // 2. We're calling this during render so it could happen multiple times!
    // This is okay though because `setQueries` is written to be idempotent.
    // 3. When the queries change, we want to immediately return the results of
    // the new queries. This happens because we recreate the `getCurrentValue`
    // callback and `useSubscription` re-executes it.
    if (effectRan) {
      observer.setQueries(queries);
    }

    return {
      getCurrentValue: () => {
        if (effectRan) {
          return observer.getCurrentQueries();
        } else {
          // If the effect hasn't run yet, our `observer` doesn't have the
          // current queries. Manually set all the results to `undefined`.
          // Once the effect runs, we'll rerender and actually pull the results
          // from the Convex client.
          const value: Record<string, undefined> = {};
          for (const identifier in Object.keys(queries)) {
            value[identifier] = undefined;
          }
          return value;
        }
      },
      subscribe: (callback: () => void) => observer.subscribe(callback),
    };
  }, [observer, queries, effectRan]);

  return useSubscription(subscription);
}

/**
 * An object representing a request to load multiple queries.
 *
 * The keys of this object are identifiers and the values are objects containing
 * the name of the query function and the arguments to pass to it.
 *
 * This is used as an argument to {@link useQueriesGeneric}.
 * @public
 */
export type RequestForQueries = Record<
  string,
  {
    name: string;
    args: Record<string, Value>;
  }
>;

/**
 * Internal type helper used by Convex code generation.
 *
 * Used to give {@link useQueriesGeneric} a type specific to your API.
 *
 * @public
 */
export type UseQueriesForAPI<API extends GenericAPI> = <
  QueryNameMap extends Record<string, PublicQueryNames<API>>
>(queries: {
  [Identifier in keyof QueryNameMap]: {
    name: QueryNameMap[Identifier];
    args: ArgsObject<NamedQuery<API, QueryNameMap[Identifier]>>;
  };
}) => {
  [Identifier in keyof QueryNameMap]:
    | ReturnType<NamedQuery<API, QueryNameMap[Identifier]>>
    | undefined
    | Error;
};
