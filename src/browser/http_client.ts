import {
  GenericAPI,
  NamedAction,
  NamedMutation,
  NamedQuery,
  OptionalRestArgs,
  PublicActionNames,
  PublicMutationNames,
  PublicQueryNames,
} from "../api/index.js";
import { parseArgs, STATUS_CODE_UDF_FAILED } from "../common/index.js";
import { version } from "../index.js";
import { convexToJson, jsonToConvex } from "../values/index.js";
import { logToConsole } from "./logging.js";

/** In browsers, Node.js 18, Deno, etc. `fetch` is a global function */
type WindowFetch = typeof window.fetch;

const fetch: WindowFetch =
  globalThis.fetch ||
  ((...args) =>
    import("node-fetch").then(({ default: fetch }) =>
      (fetch as unknown as WindowFetch)(...args)
    ));

/**
 * A Convex client that runs queries and mutations over HTTP.
 *
 * This is appropriate for server-side code (like Netlify Lambdas) or non-reactive
 * webapps.
 *
 * If you're building a React app, consider using
 * {@link react.ConvexReactClient} instead.
 *
 *
 * @public
 */
export class ConvexHttpClient<API extends GenericAPI> {
  private readonly address: string;
  private auth?: string;
  private debug: boolean;
  constructor(address: string) {
    this.address = `${address}/api`;
    this.debug = true;
  }

  /**
   * Obtain the {@link ConvexHttpClient}'s URL to its backend.
   *
   * @returns The URL to the Convex backend, including the client's API version.
   */
  backendUrl(): string {
    return this.address;
  }

  /**
   * Set the authentication token to be used for subsequent queries and mutations.
   *
   * Should be called whenever the token changes (i.e. due to expiration and refresh).
   *
   * @param value - JWT-encoded OpenID Connect identity token.
   */
  setAuth(value: string) {
    this.auth = value;
  }

  /**
   * Clear the current authentication token if set.
   */
  clearAuth() {
    this.auth = undefined;
  }

  /**
   * Sets whether the result log lines should be printed on the console or not.
   *
   * @internal
   */
  setDebug(debug: boolean) {
    this.debug = debug;
  }

  /**
   * Execute a Convex query function.
   *
   * @param name - The name of the query.
   * @param args - The arguments object for the query. If this is omitted,
   * the arguments will be `{}`.
   * @returns A promise of the query's result.
   */
  async query<Name extends PublicQueryNames<API>>(
    name: Name,
    ...args: OptionalRestArgs<NamedQuery<API, Name>>
  ): Promise<ReturnType<NamedQuery<API, Name>>> {
    const queryArgs = parseArgs(args[0]);
    const body = JSON.stringify({
      path: name,
      args: [convexToJson(queryArgs)],
      debug: this.debug,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Convex-Client": `npm-${version}`,
    };
    if (this.auth) {
      headers["Authorization"] = `Bearer ${this.auth}`;
    }
    const response = await fetch(`${this.address}/query`, {
      body,
      method: "POST",
      headers: headers,
      credentials: "include",
    });
    if (!response.ok && response.status !== STATUS_CODE_UDF_FAILED) {
      throw new Error(await response.text());
    }
    const respJSON = await response.json();

    for (const line of respJSON.logLines ?? []) {
      logToConsole("info", "query", name, line);
    }
    switch (respJSON.status) {
      case "success":
        // Validate that the response is a valid Convex value.
        return jsonToConvex(respJSON.value) as Awaited<
          ReturnType<NamedQuery<API, Name>>
        >;
      case "error":
        throw new Error(respJSON.errorMessage);
      default:
        throw new Error(`Invalid response: ${JSON.stringify(respJSON)}`);
    }
  }

  /**
   * Execute a Convex mutation function.
   *
   * @param name - The name of the mutation.
   * @param args - The arguments object for the mutation. If this is omitted,
   * the arguments will be `{}`.
   * @returns A promise of the mutation's result.
   */
  async mutation<Name extends PublicMutationNames<API>>(
    name: Name,
    ...args: OptionalRestArgs<NamedMutation<API, Name>>
  ): Promise<ReturnType<NamedMutation<API, Name>>> {
    const mutationArgs = parseArgs(args[0]);
    const body = JSON.stringify({
      path: name,
      args: [convexToJson(mutationArgs)],
      debug: this.debug,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Convex-Client": `npm-${version}`,
    };
    if (this.auth) {
      headers["Authorization"] = `Bearer ${this.auth}`;
    }
    const response = await fetch(`${this.address}/mutation`, {
      body,
      method: "POST",
      headers: headers,
      credentials: "include",
    });
    if (!response.ok && response.status !== STATUS_CODE_UDF_FAILED) {
      throw new Error(await response.text());
    }
    const respJSON = await response.json();
    for (const line of respJSON.logLines ?? []) {
      logToConsole("info", "mutation", name, line);
    }
    switch (respJSON.status) {
      case "success":
        // Validate that the response is a valid Convex value.
        return jsonToConvex(respJSON.value) as Awaited<
          ReturnType<NamedMutation<API, Name>>
        >;
      case "error":
        throw new Error(respJSON.errorMessage);
      default:
        throw new Error(`Invalid response: ${JSON.stringify(respJSON)}`);
    }
  }

  /**
   * Execute a Convex action function.
   *
   * @param name - The name of the action.
   * @param args - The arguments object for the action. If this is omitted,
   * the arguments will be `{}`.
   * @returns A promise of the action's result.
   */
  async action<Name extends PublicActionNames<API>>(
    name: Name,
    ...args: OptionalRestArgs<NamedAction<API, Name>>
  ): Promise<ReturnType<NamedAction<API, Name>>> {
    const actionArgs = parseArgs(args[0]);
    const body = JSON.stringify({
      path: name,
      args: [convexToJson(actionArgs)],
      debug: this.debug,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Convex-Client": `npm-${version}`,
    };
    if (this.auth) {
      headers["Authorization"] = `Bearer ${this.auth}`;
    }
    const response = await fetch(`${this.address}/action`, {
      body,
      method: "POST",
      headers: headers,
      credentials: "include",
    });
    if (!response.ok && response.status !== STATUS_CODE_UDF_FAILED) {
      throw new Error(await response.text());
    }
    const respJSON = await response.json();
    for (const line of respJSON.logLines ?? []) {
      logToConsole("info", "action", name, line);
    }
    switch (respJSON.status) {
      case "success":
        // Validate that the response is a valid Convex value.
        return jsonToConvex(respJSON.value) as Awaited<
          ReturnType<NamedAction<API, Name>>
        >;
      case "error":
        throw new Error(respJSON.errorMessage);
      default:
        throw new Error(`Invalid response: ${JSON.stringify(respJSON)}`);
    }
  }
}
