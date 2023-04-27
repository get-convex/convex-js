import { GenericAPI } from "../../api/index.js";
import {
  convexToJson,
  jsonToConvex,
  v,
  Validator,
} from "../../values/index.js";
import { GenericDataModel } from "../data_model.js";
import {
  ActionCtx,
  MutationCtx,
  RegisteredAction,
  PublicHttpAction,
  RegisteredMutation,
  RegisteredQuery,
  QueryCtx,
  FunctionArgs,
  MutationBuilder,
  QueryBuilder,
  ActionBuilder,
} from "../registration.js";
import { setupActionCalls } from "./actions_impl.js";
import { setupAuth } from "./authentication_impl.js";
import { setupReader, setupWriter } from "./database_impl.js";
import { QueryImpl, QueryInitializerImpl } from "./query_impl.js";
import {
  setupActionScheduler,
  setupMutationScheduler,
} from "./scheduler_impl.js";
import {
  setupStorageActionWriter,
  setupStorageReader,
  setupStorageWriter,
} from "./storage_impl.js";

async function invokeMutation<
  F extends (
    ctx: MutationCtx<GenericDataModel, GenericAPI>,
    ...args: any
  ) => any
>(func: F, argsStr: string) {
  // TODO(presley): Change the function signature and propagate the requestId from Rust.
  // Ok, to mock it out for now, since queries are only running in V8.
  const requestId = "";
  const args = jsonToConvex(JSON.parse(argsStr));
  const mutationCtx = {
    db: setupWriter(),
    auth: setupAuth(requestId),
    storage: setupStorageWriter(requestId),
    scheduler: setupMutationScheduler(),
  };
  const result = await Promise.resolve(func(mutationCtx, ...(args as any)));
  validateReturnValue(result);
  return JSON.stringify(convexToJson(result === undefined ? null : result));
}

function validateReturnValue(v: any) {
  if (v instanceof QueryInitializerImpl || v instanceof QueryImpl) {
    throw new Error(
      "Return value is a Query. Results must be retrieved with `.collect()`, `.take(n), `.unique()`, or `.first()`."
    );
  }
}

type FunctionDefinition =
  | ((ctx: any, args: FunctionArgs) => any)
  | {
      args?: Record<string, Validator<any, boolean>>;
      handler: (ctx: any, args: FunctionArgs) => any;
    };

function exportArgs(functionDefinition: FunctionDefinition) {
  return () => {
    let args = v.any();
    if (
      typeof functionDefinition === "object" &&
      functionDefinition.args !== undefined
    ) {
      args = v.object(functionDefinition.args);
    }
    return JSON.stringify(args.json);
  };
}
/**
 * Define a mutation in this Convex app's public API.
 *
 * This function will be allowed to modify your Convex database and will be accessible from the client.
 *
 * If you're using code generation, use the `mutation` function in
 * `convex/_generated/server.d.ts` which is typed for your data model.
 *
 * @param func - The mutation function. It receives a {@link MutationCtx} as its first argument.
 * @returns The wrapped mutation. Include this as an `export` to name it and make it accessible.
 *
 * @public
 */
export const mutationGeneric: MutationBuilder<any, any, "public"> = (
  functionDefinition: FunctionDefinition
) => {
  const func = (
    typeof functionDefinition === "function"
      ? functionDefinition
      : functionDefinition.handler
  ) as RegisteredMutation<"public", any, any>;

  // Helpful runtime check that functions are only be registered once
  if (func.isRegistered) {
    throw new Error("Function registered twice " + func);
  }
  func.isRegistered = true;
  func.isMutation = true;
  func.isPublic = true;
  func.invokeMutation = argsStr => invokeMutation(func, argsStr);
  func.exportArgs = exportArgs(functionDefinition);
  return func;
};

/**
 * Define a mutation that is only accessible from other Convex functions (but not from the client).
 *
 * This function will be allowed to modify your Convex database. It will not be accessible from the client.
 *
 * If you're using code generation, use the `internalMutation` function in
 * `convex/_generated/server.d.ts` which is typed for your data model.
 *
 * @param func - The mutation function. It receives a {@link MutationCtx} as its first argument.
 * @returns The wrapped mutation. Include this as an `export` to name it and make it accessible.
 *
 * @public
 */
export const internalMutationGeneric: MutationBuilder<any, any, "internal"> = (
  functionDefinition: FunctionDefinition
) => {
  const func = (
    typeof functionDefinition === "function"
      ? functionDefinition
      : functionDefinition.handler
  ) as RegisteredMutation<"internal", any, any>;

  // Helpful runtime check that functions are only be registered once
  if (func.isRegistered) {
    throw new Error("Function registered twice " + func);
  }
  func.isRegistered = true;
  func.isMutation = true;
  func.isInternal = true;
  func.invokeMutation = argsStr => invokeMutation(func, argsStr);
  func.exportArgs = exportArgs(functionDefinition);
  return func;
};

async function invokeQuery<
  F extends (ctx: QueryCtx<GenericDataModel>, ...args: any) => any
>(func: F, argsStr: string) {
  // TODO(presley): Change the function signature and propagate the requestId from Rust.
  // Ok, to mock it out for now, since queries are only running in V8.
  const requestId = "";
  const args = jsonToConvex(JSON.parse(argsStr));
  const queryCtx = {
    db: setupReader(),
    auth: setupAuth(requestId),
    storage: setupStorageReader(requestId),
  };
  const result = await Promise.resolve(func(queryCtx, ...(args as any)));
  validateReturnValue(result);
  return JSON.stringify(convexToJson(result === undefined ? null : result));
}

/**
 * Define a query in this Convex app's public API.
 *
 * This function will be allowed to read your Convex database and will be accessible from the client.
 *
 * If you're using code generation, use the `query` function in
 * `convex/_generated/server.d.ts` which is typed for your data model.
 *
 * @param func - The query function. It receives a {@link QueryCtx} as its first argument.
 * @returns The wrapped query. Include this as an `export` to name it and make it accessible.
 *
 * @public
 */
export const queryGeneric: QueryBuilder<any, "public"> = (
  functionDefinition: FunctionDefinition
) => {
  const func = (
    typeof functionDefinition === "function"
      ? functionDefinition
      : functionDefinition.handler
  ) as RegisteredQuery<"public", any, any>;

  // Helpful runtime check that functions are only be registered once
  if (func.isRegistered) {
    throw new Error("Function registered twice " + func);
  }
  func.isRegistered = true;
  func.isQuery = true;
  func.isPublic = true;
  func.invokeQuery = argsStr => invokeQuery(func, argsStr);
  func.exportArgs = exportArgs(functionDefinition);
  return func;
};

/**
 * Define a query that is only accessible from other Convex functions (but not from the client).
 *
 * This function will be allowed to read from your Convex database. It will not be accessible from the client.
 *
 * If you're using code generation, use the `internalQuery` function in
 * `convex/_generated/server.d.ts` which is typed for your data model.
 *
 * @param func - The query function. It receives a {@link QueryCtx} as its first argument.
 * @returns The wrapped query. Include this as an `export` to name it and make it accessible.
 *
 * @public
 */
export const internalQueryGeneric: QueryBuilder<any, "internal"> = (
  functionDefinition: FunctionDefinition
) => {
  const func = (
    typeof functionDefinition === "function"
      ? functionDefinition
      : functionDefinition.handler
  ) as RegisteredQuery<"internal", any, any>;

  // Helpful runtime check that functions are only be registered once
  if (func.isRegistered) {
    throw new Error("Function registered twice " + func);
  }
  func.isRegistered = true;
  func.isQuery = true;
  func.isInternal = true;
  func.invokeQuery = argsStr => invokeQuery(func as any, argsStr);
  func.exportArgs = exportArgs(functionDefinition);
  return func;
};

async function invokeAction<
  API extends GenericAPI,
  F extends (ctx: ActionCtx<API>, ...args: any) => any
>(func: F, requestId: string, argsStr: string) {
  const args = jsonToConvex(JSON.parse(argsStr));
  const calls = setupActionCalls(requestId);
  const ctx = {
    ...calls,
    auth: setupAuth(requestId),
    scheduler: setupActionScheduler(requestId),
    storage: setupStorageActionWriter(requestId),
  };
  const result = await Promise.resolve(func(ctx, ...(args as any)));
  return JSON.stringify(convexToJson(result === undefined ? null : result));
}

/**
 * Define an action in this Convex app's public API.
 *
 * If you're using code generation, use the `action` function in
 * `convex/_generated/server.d.ts` which is typed for your data model.
 *
 * @param func - The function. It receives a {@link ActionCtx} as its first argument.
 * @returns The wrapped function. Include this as an `export` to name it and make it accessible.
 *
 * @public
 */
export const actionGeneric: ActionBuilder<any, "public"> = (
  functionDefinition: FunctionDefinition
) => {
  const func = (
    typeof functionDefinition === "function"
      ? functionDefinition
      : functionDefinition.handler
  ) as RegisteredAction<"public", any, any>;

  // Helpful runtime check that functions are only be registered once
  if (func.isRegistered) {
    throw new Error("Function registered twice " + func);
  }
  func.isRegistered = true;
  func.isAction = true;
  func.isPublic = true;
  func.invokeAction = (requestId, argsStr) =>
    invokeAction(func, requestId, argsStr);
  func.exportArgs = exportArgs(functionDefinition);
  return func;
};

/**
 * Define an action that is only accessible from other Convex functions (but not from the client).
 *
 * If you're using code generation, use the `internalAction` function in
 * `convex/_generated/server.d.ts` which is typed for your data model.
 *
 * @param func - The function. It receives a {@link ActionCtx} as its first argument.
 * @returns The wrapped function. Include this as an `export` to name it and make it accessible.
 *
 * @public
 */
export const internalActionGeneric: ActionBuilder<any, "internal"> = (
  functionDefinition: FunctionDefinition
) => {
  const func = (
    typeof functionDefinition === "function"
      ? functionDefinition
      : functionDefinition.handler
  ) as RegisteredAction<"internal", any, any>;

  // Helpful runtime check that functions are only be registered once
  if (func.isRegistered) {
    throw new Error("Function registered twice " + func);
  }
  func.isRegistered = true;
  func.isAction = true;
  func.isInternal = true;
  func.invokeAction = (requestId, argsStr) =>
    invokeAction(func, requestId, argsStr);
  func.exportArgs = exportArgs(functionDefinition);
  return func;
};

async function invokeHttpAction<
  API extends GenericAPI,
  F extends (ctx: ActionCtx<API>, request: Request) => any
>(func: F, request: Request) {
  // TODO(presley): Change the function signature and propagate the requestId from Rust.
  // Ok, to mock it out for now, since http endpoints are only running in V8.
  const requestId = "";
  const calls = setupActionCalls(requestId);
  const ctx = {
    ...calls,
    auth: setupAuth(requestId),
    storage: setupStorageActionWriter(requestId),
    scheduler: setupActionScheduler(requestId),
  };
  return await Promise.resolve(func(ctx, request));
}

/**
 * Define a Convex HTTP action.
 *
 * @param func - The function. It receives an {@link ActionCtx} as its first argument, and a `Request` object
 * as its second.
 * @returns The wrapped function. Route a URL path to this function in `convex/http.js`.
 *
 * @public
 */
export const httpActionGeneric = <API extends GenericAPI>(
  func: (ctx: ActionCtx<API>, request: Request) => Promise<Response>
): PublicHttpAction => {
  const q = func as unknown as PublicHttpAction;
  // Helpful runtime check that functions are only be registered once
  if (q.isRegistered) {
    throw new Error("Function registered twice " + func);
  }
  q.isRegistered = true;
  q.isHttp = true;
  q.invokeHttpAction = request => invokeHttpAction(func as any, request);
  return q;
};
