/**
 * Tools to integrate Convex into React applications.
 *
 * This module contains:
 * 1. {@link ConvexReactClient}, a client for using Convex in React.
 * 2. {@link ConvexProvider}, a component that stores this client in React context.
 * 3. {@link Authenticated}, {@link Unauthenticated} and {@link AuthLoading} helper auth components.
 * 4. [Hooks](https://docs.convex.dev/generated-api/react#react-hooks) for calling into
 *    this client within your React components.
 *
 * ## Usage
 *
 * ### Creating the client
 *
 * ```typescript
 * import { ConvexReactClient } from "convex/react";
 *
 * // typically loaded from an environment variable
 * const address = "https://small-mouse-123.convex.cloud"
 * const convex = new ConvexReactClient(address);
 * ```
 *
 * ### Storing the client in React Context
 *
 * ```typescript
 * import { ConvexProvider } from "convex/react";
 *
 * <ConvexProvider client={convex}>
 *   <App />
 * </ConvexProvider>
 * ```
 *
 * ### Using the auth helpers
 *
 * ```typescript
 * import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
 *
 * <Authenticated>
 *   Logged in
 * </Authenticated>
 * <Unauthenticated>
 *   Logged out
 * </Unauthenticated>
 * <AuthLoading>
 *   Still loading
 * </AuthLoading>
 * ```
 *
 * ### Generating typed hooks
 *
 * This module is typically used alongside generated hooks.
 *
 * To generate the hooks, run `npx convex dev` in your Convex project. This
 * will create a `convex/_generated/react.js` file with the following React
 * hooks, typed for your queries and mutations:
 * - [useQuery](https://docs.convex.dev/generated-api/react#usequery)
 * - [useMutation](https://docs.convex.dev/generated-api/react#usemutation)
 * - [useConvex](https://docs.convex.dev/generated-api/react#useconvex)
 * - [usePaginatedQuery](https://docs.convex.dev/generated-api/react#usepaginatedquery)
 * - [useQueries](https://docs.convex.dev/generated-api/react#usequeries)
 *
 * If you aren't using code generation, you can use these untyped hooks instead:
 * - {@link useQueryGeneric}
 * - {@link useMutationGeneric}
 * - {@link useConvexGeneric}
 * - {@link usePaginatedQueryGeneric}
 * - {@link useQueriesGeneric}
 *
 * ### Using the hooks
 *
 * ```typescript
 * import { useQuery, useMutation } from "../convex/_generated/react";
 *
 * function App() {
 *   const counter = useQuery("getCounter");
 *   const increment = useMutation("incrementCounter");
 *   // Your component here!
 * }
 * ```
 * @module
 */
export * from "./use_paginated_query.js";
export {
  useQueriesGeneric,
  type RequestForQueries,
  type UseQueriesForAPI,
} from "./use_queries.js";
export type { AuthTokenFetcher } from "../browser/sync/client.js";
export * from "./auth_helpers.js";
export * from "./ConvexAuthState.js";
export { useSubscription } from "./use_subscription.js";
export {
  type ReactMutation,
  type ReactAction,
  type Watch,
  type WatchQueryOptions,
  type MutationOptions,
  ConvexReactClient,
  useConvexGeneric,
  ConvexProvider,
  type UseQueryOptions,
  useQueryGeneric,
  useMutationGeneric,
  useActionGeneric,
  type UseQueryForAPI,
  type UseMutationForAPI,
  type UseActionForAPI,
  type UseConvexForAPI,
} from "./client.js";
