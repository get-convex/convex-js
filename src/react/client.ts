import {
  GenericAPI,
  BaseConvexClient,
  NamedMutation,
  NamedQuery,
  NamedAction,
  PublicQueryNames,
  PublicMutationNames,
  PublicActionNames,
  ArgsAndOptions,
  ArgsObject,
  OptionalRestArgs,
} from "../browser/index.js";
import type { OptimisticUpdate, QueryToken } from "../browser/index.js";
import React, { useContext, useMemo } from "react";
import { convexToJson, Value } from "../values/index.js";
import ReactDOM from "react-dom";
import { useSubscription } from "./use_subscription.js";
import { QueryJournal } from "../browser/sync/protocol.js";
import {
  AuthTokenFetcher,
  ClientOptions,
  ConnectionState,
} from "../browser/sync/client.js";
import type { UserIdentityAttributes } from "../browser/sync/protocol.js";
import { parseArgs } from "../common/index.js";

if (typeof React === "undefined") {
  throw new Error("Required dependency 'react' not found");
}
if (typeof ReactDOM === "undefined") {
  throw new Error("Required dependency 'react-dom' not found");
}

// TODO Typedoc doesn't generate documentation for the comment below perhaps
// because it's a callable interface.
/**
 * An interface to execute a Convex mutation function on the server.
 *
 * @public
 */
export interface ReactMutation<
  API extends GenericAPI,
  Name extends PublicMutationNames<API>
> {
  /**
   * Execute the mutation on the server, returning a `Promise` of its return value.
   *
   * @param args - Arguments for the mutation to pass up to the server.
   * @returns The return value of the server-side function call.
   */
  (...args: OptionalRestArgs<NamedMutation<API, Name>>): Promise<
    ReturnType<NamedMutation<API, Name>>
  >;

  /**
   * Define an optimistic update to apply as part of this mutation.
   *
   * This is a temporary update to the local query results to facilitate a
   * fast, interactive UI. It enables query results to update before a mutation
   * executed on the server.
   *
   * When the mutation is invoked, the optimistic update will be applied.
   *
   * Optimistic updates can also be used to temporarily remove queries from the
   * client and create loading experiences until a mutation completes and the
   * new query results are synced.
   *
   * The update will be automatically rolled back when the mutation is fully
   * completed and queries have been updated.
   *
   * @param optimisticUpdate - The optimistic update to apply.
   * @returns A new `ReactMutation` with the update configured.
   *
   * @public
   */
  withOptimisticUpdate(
    optimisticUpdate: OptimisticUpdate<
      API,
      ArgsObject<NamedMutation<API, Name>>
    >
  ): ReactMutation<API, Name>;
}

// Exported only for testing.
export function createMutation(
  name: string,
  client: ConvexReactClient<any>,
  update?: OptimisticUpdate<any, any>
): ReactMutation<any, any> {
  function mutation(args?: Record<string, Value>): Promise<unknown> {
    assertNotAccidentalArgument(args);

    return client.mutation(name, args, { optimisticUpdate: update });
  }
  mutation.withOptimisticUpdate = function withOptimisticUpdate(
    optimisticUpdate: OptimisticUpdate<any, any>
  ): ReactMutation<any, any> {
    if (update !== undefined) {
      throw new Error(
        `Already specified optimistic update for mutation ${name}`
      );
    }
    return createMutation(name, client, optimisticUpdate);
  };
  return mutation as ReactMutation<any, any>;
}

/**
 * An interface to execute a Convex action on the server.
 *
 * @public
 */
export interface ReactAction<
  API extends GenericAPI,
  Name extends PublicActionNames<API>
> {
  /**
   * Execute the function on the server, returning a `Promise` of its return value.
   *
   * @param args - Arguments for the function to pass up to the server.
   * @returns The return value of the server-side function call.
   * @public
   */
  (...args: OptionalRestArgs<NamedAction<API, Name>>): Promise<
    ReturnType<NamedAction<API, Name>>
  >;
}

function createAction(
  name: string,
  client: ConvexReactClient<any>
): ReactAction<any, any> {
  return function (args?: Record<string, Value>): Promise<unknown> {
    return client.action(name, args);
  } as ReactAction<any, any>;
}

/**
 * A watch on the output of a Convex query function.
 *
 * @public
 */
export interface Watch<T> {
  /**
   * Initiate a watch on the output of a query.
   *
   * This will subscribe to this query and call
   * the callback whenever the query result changes.
   *
   * **Important: If the query is already known on the client this watch will
   * never be invoked.** To get the current, local result call
   * {@link react.Watch.localQueryResult}.
   *
   * @param callback - Function that is called whenever the query result changes.
   * @returns - A function that disposes of the subscription.
   */
  onUpdate(callback: () => void): () => void;

  /**
   * Get the current result of a query.
   *
   * This will only return a result if we're already subscribed to the query
   * and have received a result from the server or the query value has been set
   * optimistically.
   *
   * @returns The result of the query or `undefined` if it isn't known.
   * @throws An error if the query encountered an error on the server.
   */
  localQueryResult(): T | undefined;

  /**
   * @internal
   */
  localQueryLogs(): string[] | undefined;

  /**
   * Get the current {@link browser.QueryJournal} for this query.
   *
   * If we have not yet received a result for this query, this will be `undefined`.
   */
  journal(): QueryJournal | undefined;
}

/**
 * Options for {@link ConvexReactClient.watchQuery}.
 *
 * @public
 */
export interface WatchQueryOptions {
  /**
   * An (optional) journal produced from a previous execution of this query
   * function.
   *
   * If there is an existing subscription to a query function with the same
   * name and arguments, this journal will have no effect.
   */
  journal?: QueryJournal;
}

/**
 * Options for {@link ConvexReactClient.mutation}.
 *
 * @public
 */
export interface MutationOptions<
  API extends GenericAPI,
  Args extends Record<string, Value>
> {
  /**
   * An optimistic update to apply along with this mutation.
   *
   * An optimistic update locally updates queries while a mutation is pending.
   * Once the mutation completes, the update will be rolled back.
   */
  optimisticUpdate?: OptimisticUpdate<API, Args>;
}

/**
 * A Convex client for use within React.
 *
 * This loads reactive queries and executes mutations over a WebSocket.
 *
 * @typeParam API - The API of your application, composed of all Convex queries
 * and mutations. `npx convex dev` [generates this type](/generated-api/react#convexapi)
 * in `convex/_generated/react.d.ts`.
 * @public
 */
export class ConvexReactClient<API extends GenericAPI> {
  private address: string;
  private cachedSync?: BaseConvexClient;
  private listeners: Map<QueryToken, Set<() => void>>;
  private options: ClientOptions;
  private closed = false;

  private adminAuth?: string;
  private fakeUserIdentity?: UserIdentityAttributes;

  /**
   * @param address - The url of your Convex deployment, often provided
   * by an environment variable. E.g. `https://small-mouse-123.convex.cloud`.
   * @param options - See {@link ClientOptions} for a full description.
   */
  constructor(address: string, options?: ClientOptions) {
    // Validate address immediately since validation by the lazily-instantiated
    // internal client does not occur synchronously.
    if (typeof address !== "string") {
      throw new Error(
        "ConvexReactClient requires a URL like 'https://happy-otter-123.convex.cloud'."
      );
    }
    if (!address.includes("://")) {
      throw new Error("Provided address was not an absolute URL.");
    }
    this.address = address;
    this.listeners = new Map();
    this.options = { ...options };
  }

  /**
   * Lazily instantiate the `BaseConvexClient` so we don't create the WebSocket
   * when server-side rendering.
   *
   * @internal
   */
  get sync() {
    if (this.closed) {
      throw new Error("ConvexReactClient has already been closed.");
    }
    if (this.cachedSync) {
      return this.cachedSync;
    }
    this.cachedSync = new BaseConvexClient(
      this.address,
      updatedQueries => this.transition(updatedQueries),
      this.options
    );
    if (this.adminAuth) {
      this.cachedSync.setAdminAuth(this.adminAuth, this.fakeUserIdentity);
    }
    return this.cachedSync;
  }

  /**
   * Set the authentication token to be used for subsequent queries and mutations.
   * `fetchToken` will be called automatically again if a token expires.
   * `fetchToken` should return `null` if the token cannot be retrieved, for example
   * when the user's rights were permanently revoked.
   * @param fetchToken - an async function returning the JWT-encoded OpenID Connect Identity Token
   * @param onChange - a callback that will be called when the authentication status changes
   */
  setAuth(
    fetchToken: AuthTokenFetcher,
    onChange?: (isAuthenticated: boolean) => void
  ) {
    if (typeof fetchToken === "string") {
      throw new Error(
        "Passing a string to ConvexReactClient.setAuth is no longer supported, " +
          "please upgrade to passing in an async function to handle reauthentication."
      );
    }
    this.sync.setAuth(
      fetchToken,
      onChange ??
        (() => {
          // Do nothing
        })
    );
  }

  /**
   * Clear the current authentication token if set.
   */
  clearAuth() {
    this.sync.clearAuth();
  }

  /**
   * @internal
   */
  setAdminAuth(token: string, identity?: UserIdentityAttributes) {
    this.adminAuth = token;
    this.fakeUserIdentity = identity;
    if (this.closed) {
      throw new Error("ConvexReactClient has already been closed.");
    }
    if (this.cachedSync) {
      this.sync.setAdminAuth(token, identity);
    }
  }

  /**
   * Construct a new {@link Watch} on a Convex query function.
   *
   * **Most application code should not call this method directly. Instead use
   * the `useQuery` hook generated by `npx convex dev`.**
   *
   * @param name - The name of the query function.
   * @param args - An arguments object for the query. If this is omitted,
   * the arguments will be `{}`.
   * @param options - A {@link WatchQueryOptions} options object for this query.
   *
   * @returns The {@link Watch} object.
   */
  watchQuery<Name extends PublicQueryNames<API>>(
    name: Name,
    ...argsAndOptions: ArgsAndOptions<NamedQuery<API, Name>, WatchQueryOptions>
  ): Watch<ReturnType<NamedQuery<API, Name>>> {
    const [args, options] = argsAndOptions;

    return {
      onUpdate: callback => {
        const { queryToken, unsubscribe } = this.sync.subscribe(
          name as string,
          args,
          options
        );

        const currentListeners = this.listeners.get(queryToken);
        if (currentListeners !== undefined) {
          currentListeners.add(callback);
        } else {
          this.listeners.set(queryToken, new Set([callback]));
        }

        return () => {
          if (this.closed) {
            return;
          }

          const currentListeners = this.listeners.get(queryToken)!;
          currentListeners.delete(callback);
          if (currentListeners.size === 0) {
            this.listeners.delete(queryToken);
          }
          unsubscribe();
        };
      },

      localQueryResult: () => {
        // Use the cached client because we can't have a query result if we don't
        // even have a client yet!
        if (this.cachedSync) {
          return this.cachedSync.localQueryResult(name, args) as ReturnType<
            NamedQuery<API, Name>
          >;
        }
        return undefined;
      },

      localQueryLogs: () => {
        if (this.cachedSync) {
          return this.cachedSync.localQueryLogs(name, args);
        }
        return undefined;
      },

      journal: () => {
        if (this.cachedSync) {
          return this.cachedSync.queryJournal(name, args);
        }
        return undefined;
      },
    };
  }

  /**
   * Execute a mutation function.
   *
   * If you are within a React component, use the `useMutation` hook generated
   * by `npx convex dev` instead.
   *
   * @param name - The name of the mutation.
   * @param args - An arguments object for the mutation. If this is omitted,
   * the arguments will be `{}`.
   * @param options - A {@link MutationOptions} options object for the mutation.
   * @returns A promise of the mutation's result.
   */
  mutation<Name extends PublicMutationNames<API>>(
    name: Name,
    ...argsAndOptions: ArgsAndOptions<
      NamedMutation<API, Name>,
      MutationOptions<API, ArgsObject<NamedMutation<API, Name>>>
    >
  ): Promise<ReturnType<NamedMutation<API, Name>>> {
    const [args, options] = argsAndOptions;
    return this.sync.mutation(name, args, options);
  }

  /**
   * Execute an action function.
   *
   * If you are within a React component, use the `useAction` hook generated
   * by `npx convex dev` instead.
   *
   * @param name - The name of the action.
   * @param args - An arguments object for the action. If this is omitted,
   * the arguments will be `{}`.
   * @returns A promise of the action's result.
   */
  action<Name extends PublicActionNames<API>>(
    name: Name,
    ...args: OptionalRestArgs<NamedAction<API, Name>>
  ): Promise<ReturnType<NamedAction<API, Name>>> {
    return this.sync.action(name, ...args);
  }

  /**
   * Get the current {@link ConnectionState} between the client and the Convex
   * backend.
   *
   * @returns The {@link ConnectionState} with the Convex backend.
   */
  connectionState(): ConnectionState {
    return this.sync.connectionState();
  }

  /**
   * Close any network handles associated with this client and stop all subscriptions.
   *
   * Call this method when you're done with a {@link ConvexReactClient} to
   * dispose of its sockets and resources.
   *
   * @returns A `Promise` fulfilled when the connection has been completely closed.
   */
  async close(): Promise<void> {
    this.closed = true;
    // Prevent outstanding React batched updates from invoking listeners.
    this.listeners = new Map();
    if (this.cachedSync) {
      const sync = this.cachedSync;
      this.cachedSync = undefined;
      await sync.close();
    }
  }

  private transition(updatedQueries: QueryToken[]) {
    ReactDOM.unstable_batchedUpdates(() => {
      for (const queryToken of updatedQueries) {
        const callbacks = this.listeners.get(queryToken);
        if (callbacks) {
          for (const callback of callbacks) {
            callback();
          }
        }
      }
    });
  }
}

const ConvexContext = React.createContext<ConvexReactClient<any>>(
  undefined as unknown as ConvexReactClient<any> // in the future this will be a mocked client for testing
);

/**
 * Get the {@link ConvexReactClient} within a React component.
 *
 * This relies on the {@link ConvexProvider} being above in the React component tree.
 *
 * If you're using code generation, use the `useConvex` function in
 * `convex/_generated/react.js` which is typed for your API.
 *
 * @returns The active {@link ConvexReactClient} object, or `undefined`.
 *
 * @public
 */
export function useConvexGeneric<
  API extends GenericAPI
>(): ConvexReactClient<API> {
  return useContext(ConvexContext);
}

/**
 * Provides an active Convex {@link ConvexReactClient} to descendants of this component.
 *
 * Wrap your app in this component to use Convex hooks `useQuery`,
 * `useMutation`, and `useConvex`.
 *
 * @param props - an object with a `client` property that refers to a {@link ConvexReactClient}.
 *
 * @public
 */
export const ConvexProvider: React.FC<{
  client: ConvexReactClient<any>;
  children?: React.ReactNode;
}> = ({ client, children }) => {
  return React.createElement(
    ConvexContext.Provider,
    { value: client },
    children
  );
};

/**
 * Options object for {@link useQueryGeneric}.
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface UseQueryOptions {
  // TODO: Add options here once we want to support them.
}

/**
 * Load a reactive query within a React component.
 *
 * This React hook contains internal state that will cause a rerender
 * whenever the query result changes.
 *
 * Throws an error if not used under {@link ConvexProvider}.
 *
 * If you're using code generation, use the `useQuery` function in
 * `convex/_generated/react.js` which is typed for your API.
 *
 * @param name - The name of the query function.
 * @param args - The arguments to the query function.
 * @returns `undefined` if loading and the query's return value otherwise.
 *
 * @public
 */
export function useQueryGeneric(
  name: string,
  args?: Record<string, Value>,
  _options?: UseQueryOptions
): unknown | undefined {
  const convex = useContext(ConvexContext);
  if (convex === undefined) {
    throw new Error(
      "Could not find Convex client! `useQuery` must be used in the React component " +
        "tree under `ConvexProvider`. Did you forget it? " +
        "See https://docs.convex.dev/quick-start#set-up-convex-in-your-react-app"
    );
  }

  const queryArgs = parseArgs(args);

  const subscription = useMemo(
    () => {
      const watch = convex.watchQuery(name, queryArgs);
      return {
        getCurrentValue: () => watch.localQueryResult(),
        subscribe: (callback: () => void) => watch.onUpdate(callback),
      };
    },
    // ESLint doesn't like that we're stringifying the args. We do this because
    // we want to avoid recreating the subscription if the args are a different
    // object that serializes to the same result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, convex, JSON.stringify(convexToJson(queryArgs))]
  );

  const queryResult = useSubscription(subscription);
  return queryResult;
}

/**
 * Construct a new {@link ReactMutation}.
 *
 * Mutation objects can be called like functions to request execution of the
 * corresponding Convex function, or further configured with
 * [optimistic updates](https://docs.convex.dev/using/optimistic-updates).
 *
 * The value returned by this hook is stable across renders, so it can be used
 * by React dependency arrays and memoization logic relying on object identity
 * without causing rerenders.
 *
 * If you're using code generation, use the `useMutation` function in
 * `convex/_generated/react.js` which is typed for your API.
 *
 * Throws an error if not used under {@link ConvexProvider}.
 *
 * @param name - The name of the mutation.
 * @returns The {@link ReactMutation} object with that name.
 *
 * @public
 */
export function useMutationGeneric<
  API extends GenericAPI,
  Name extends PublicMutationNames<API>
>(name: Name): ReactMutation<API, Name> {
  const convex = useContext(ConvexContext);
  if (convex === undefined) {
    throw new Error(
      "Could not find Convex client! `useMutation` must be used in the React component " +
        "tree under `ConvexProvider`. Did you forget it? " +
        "See https://docs.convex.dev/quick-start#set-up-convex-in-your-react-app"
    );
  }
  return useMemo(() => createMutation(name, convex), [convex, name]);
}

/**
 * Construct a new {@link ReactAction}.
 *
 * Action objects can be called like functions to request execution of the
 * corresponding Convex function.
 *
 * The value returned by this hook is stable across renders, so it can be used
 * by React dependency arrays and memoization logic relying on object identity
 * without causing rerenders.
 *
 * If you're using code generation, use the `useAction` function in
 * `convex/_generated/react.js` which is typed for your API.
 *
 * Throws an error if not used under {@link ConvexProvider}.
 *
 * @param name - The name of the action.
 * @returns The {@link ReactAction} object with that name.
 *
 * @public
 */
export function useActionGeneric<
  API extends GenericAPI,
  Name extends PublicActionNames<API>
>(name: Name): ReactAction<API, Name> {
  const convex = useContext(ConvexContext);
  if (convex === undefined) {
    throw new Error(
      "Could not find Convex client! `useAction` must be used in the React component " +
        "tree under `ConvexProvider`. Did you forget it? " +
        "See https://docs.convex.dev/quick-start#set-up-convex-in-your-react-app"
    );
  }
  return useMemo(() => createAction(name, convex), [convex, name]);
}

/**
 * Internal type helper used by Convex code generation.
 *
 * Used to give {@link useQueryGeneric} a type specific to your API.
 * @public
 */
export type UseQueryForAPI<API extends GenericAPI> = <
  Name extends PublicQueryNames<API>
>(
  name: Name,
  ...argsAndOptions: ArgsAndOptions<NamedQuery<API, Name>, UseQueryOptions>
) => ReturnType<NamedQuery<API, Name>> | undefined;

/**
 * Internal type helper used by Convex code generation.
 *
 * Used to give {@link useMutationGeneric} a type specific to your API.
 * @public
 */
export type UseMutationForAPI<API extends GenericAPI> = <
  Name extends PublicMutationNames<API>
>(
  name: Name
) => ReactMutation<API, Name>;

/**
 * Internal type helper used by Convex code generation.
 *
 * Used to give {@link useMutationGeneric} a type specific to your API.
 * @public
 */
export type UseActionForAPI<API extends GenericAPI> = <
  Name extends PublicActionNames<API>
>(
  name: Name
) => ReactAction<API, Name>;

/**
 * Internal type helper used by Convex code generation.
 *
 * Used to give {@link useConvexGeneric} a type specific to your API.
 * @public
 */
export type UseConvexForAPI<API extends GenericAPI> =
  () => ConvexReactClient<API>;

// When a function is called with a single argument that looks like a
// React SyntheticEvent it was likely called as an event handler.
function assertNotAccidentalArgument(value: any) {
  // these are properties of a React.SyntheticEvent
  // https://reactjs.org/docs/events.html
  if (
    typeof value === "object" &&
    value !== null &&
    "bubbles" in value &&
    "persist" in value &&
    "isDefaultPrevented" in value
  ) {
    throw new Error(
      `Convex function called with SyntheticEvent object. Did you use a Convex function as an event handler directly? Event handlers like onClick receive an event object as their first argument. These SyntheticEvent objects are not valid Convex values. Try wrapping the function like \`const handler = () => myMutation();\` and using \`handler\` in the event handler.`
    );
  }
}
