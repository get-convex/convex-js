import { useMemo } from "react";
import { useQuery } from "../react/client.js";
import { FunctionReference, makeFunctionReference } from "../server/api.js";
import { jsonToConvex } from "../values/index.js";

/**
 * The preloaded query payload, which should be passed to a client component
 * and passed to {@link usePreloadedQuery}.
 *
 * @public
 */
export type Preloaded<Query extends FunctionReference<"query">> = {
  __type: Query;
  _name: string;
  _argsJSON: string;
  _valueJSON: string;
};

/**
 * Load a reactive query within a React component using a `Preloaded` payload
 * from a Server Component returned by {@link nextjs.preloadQuery}.
 *
 * This React hook contains internal state that will cause a rerender
 * whenever the query result changes.
 *
 * Throws an error if not used under {@link ConvexProvider}.
 *
 * @param preloadedQuery - The `Preloaded` query payload from a Server Component.
 * @param options - Options for the query, including whether to skip it.
 * @returns the result of the query. Initially returns the result fetched
 * by the Server Component. Subsequently returns the result fetched by the client.
 * If the query is skipped, returns `undefined`.
 *
 * @public
 */
export function usePreloadedQuery<Query extends FunctionReference<"query">>(
  preloadedQuery: Preloaded<Query>,
): Query["_returnType"];

export function usePreloadedQuery<Query extends FunctionReference<"query">>(
  preloadedQuery: Preloaded<Query> | "skip",
): Query["_returnType"] | undefined;

export function usePreloadedQuery<Query extends FunctionReference<"query">>(
  preloadedQuery: Preloaded<Query> | "skip",
) {
  const skip = preloadedQuery === "skip";

  const args = useMemo(
    () =>
      (skip
        ? undefined
        : jsonToConvex(preloadedQuery._argsJSON)) as Query["_args"],
    [preloadedQuery, skip],
  );

  const preloadedResult = useMemo(
    () => (skip ? undefined : jsonToConvex(preloadedQuery._valueJSON)),
    [preloadedQuery, skip],
  );

  const result = useQuery(
    skip
      ? (makeFunctionReference("_skip") as Query)
      : (makeFunctionReference(preloadedQuery._name) as Query),
    skip ? ("skip" as const) : args,
  );

  return skip ? undefined : result === undefined ? preloadedResult : result;
}
