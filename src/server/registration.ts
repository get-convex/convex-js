import {
  Auth,
  DatabaseReader,
  DatabaseWriter,
  StorageActionWriter,
  StorageReader,
  StorageWriter,
} from ".";
import {
  ActionNames,
  GenericAPI,
  MutationNames,
  NamedAction,
  NamedMutation,
  NamedQuery,
  OptionalRestArgs,
  QueryNames,
} from "../browser";
import { ObjectType, PropertyValidators } from "../values/validator";
import { GenericDataModel } from "./data_model.js";
import { Scheduler } from "./scheduler";
/**
 * A set of services for use within Convex mutation functions.
 *
 * The mutation context is passed as the first argument to any Convex mutation
 * function run on the server.
 *
 * If you're using code generation, use the `MutationCtx` type in
 * `convex/_generated/server.d.ts` which is typed for your data model.
 *
 * @public
 */
export interface MutationCtx<
  DataModel extends GenericDataModel,
  API extends GenericAPI
> {
  /**
   * A utility for reading and writing data in the database.
   */
  db: DatabaseWriter<DataModel>;

  /**
   * Information about the currently authenticated user.
   */
  auth: Auth;

  /**
   * A utility for reading and writing files in storage.
   */
  storage: StorageWriter;

  /**
   * A utility for scheduling Convex functions to run in the future.
   */
  scheduler: Scheduler<API>;
}

/**
 * A set of services for use within Convex query functions.
 *
 * The query context is passed as the first argument to any Convex query
 * function run on the server.
 *
 * This differs from the {@link MutationCtx} because all of the services are
 * read-only.
 *
 * If you're using code generation, use the `QueryCtx` type in
 * `convex/_generated/server.d.ts` which is typed for your data model.
 *
 * @public
 */
export interface QueryCtx<DataModel extends GenericDataModel> {
  /**
   * A utility for reading data in the database.
   */
  db: DatabaseReader<DataModel>;

  /**
   * Information about the currently authenticated user.
   */
  auth: Auth;

  /**
   * A utility for reading files in storage.
   */
  storage: StorageReader;
}

/**
 * A set of services for use within Convex action functions.
 *
 * The context is passed as the first argument to any Convex action
 * run on the server.
 *
 * If you're using code generation, use the `ActionCtx` type in
 * `convex/_generated/server.d.ts` which is typed for your data model.
 *
 * @public
 */
export interface ActionCtx<API extends GenericAPI> {
  /**
   * Runs the Convex query with the given name and arguments.
   *
   * Consider using an {@link internalQuery} to prevent users from calling the
   * query directly.
   */
  runQuery<Name extends QueryNames<API>>(
    name: Name,
    ...args: OptionalRestArgs<NamedQuery<API, Name>>
  ): Promise<ReturnType<NamedQuery<API, Name>>>;

  /**
   * Runs the Convex mutation with the given name and arguments.
   *
   * Consider using an {@link internalMutation} to prevent users from calling
   * the mutation directly.
   */
  runMutation<Name extends MutationNames<API>>(
    name: Name,
    ...args: OptionalRestArgs<NamedMutation<API, Name>>
  ): Promise<ReturnType<NamedMutation<API, Name>>>;

  /**
   * Runs the Convex action with the given name and arguments.
   *
   * Consider using an {@link internalAction} to prevent users from calling the
   * action directly.
   */
  runAction<Name extends ActionNames<API>>(
    name: Name,
    ...args: OptionalRestArgs<NamedAction<API, Name>>
  ): Promise<ReturnType<NamedAction<API, Name>>>;

  /**
   * A utility for scheduling Convex functions to run in the future.
   */
  scheduler: Scheduler<API>;

  /**
   * Information about the currently authenticated user.
   */
  auth: Auth;

  /**
   * A utility for reading and writing files in storage.
   */
  storage: StorageActionWriter;
}

/**
 * The arguments to a Convex query, mutation, or action function.
 *
 * Convex functions always take an arguments object that maps the argument
 * names to their values.
 *
 * @public
 */
export type FunctionArgs = Record<string, unknown>;

/**
 * The arguments array for a function that takes arguments.
 *
 * This is an array of a single {@link FunctionArgs} element.
 */
type OneArgArray = [FunctionArgs];

/**
 * The arguments to a function that takes no arguments (just an empty array).
 */
type NoArgsArray = [];

/**
 * An array of arguments to a Convex function.
 *
 * Convex functions can take either a single {@link FunctionArgs} object or no
 * args at all.
 */
export type ArgsArray = OneArgArray | NoArgsArray;

/**
 * A type representing the visibility of a Convex function.
 */
type FunctionVisibility = "public" | "internal";

/**
 * Given a {@link FunctionVisibility}, should this function have `isPublic: true`
 * or `isInternal: true`?
 */
type VisibilityProperties<Visiblity extends FunctionVisibility> =
  Visiblity extends "public"
    ? {
        isPublic: true;
      }
    : {
        isInternal: true;
      };

/**
 * A mutation function that is part of this app.
 *
 * You can create a mutation by wrapping your function in
 * {@link mutationGeneric} or {@link internalMutationGeneric} and exporting it.
 *
 * @public
 */
export type RegisteredMutation<
  Visibility extends FunctionVisibility,
  Args extends ArgsArray,
  Output
> = {
  (ctx: MutationCtx<any, any>, ...args: Args): Output;

  args: Args;
  output: Output;

  isMutation: true;
  isRegistered?: true;

  /** @internal */
  invokeMutation(argsStr: string): Promise<string>;

  /** @internal */
  exportArgs(): string;
} & VisibilityProperties<Visibility>;

/**
 * A query function that is part of this app.
 *
 * You can create a query by wrapping your function in
 * {@link queryGeneric} or {@link internalQueryGeneric} and exporting it.
 *
 * @public
 */
export type RegisteredQuery<
  Visibility extends FunctionVisibility,
  Args extends ArgsArray,
  Output
> = {
  (ctx: QueryCtx<any>, ...args: Args): Output;

  args: Args;
  output: Output;

  isQuery: true;
  isRegistered?: true;

  /** @internal */
  invokeQuery(argsStr: string): Promise<string>;

  /** @internal */
  exportArgs(): string;
} & VisibilityProperties<Visibility>;

/**
 * An action that is part of this app.
 *
 * You can create an action by wrapping your function in
 * {@link actionGeneric} or {@link internalActionGeneric} and exporting it.
 *
 * @public
 */
export type RegisteredAction<
  Visibility extends FunctionVisibility,
  Args extends ArgsArray,
  Output
> = {
  (ctx: ActionCtx<any>, ...args: Args): Output;

  args: Args;
  output: Output;

  isAction: true;
  isRegistered?: true;

  /** @internal */
  invokeAction(requestId: string, argsStr: string): Promise<string>;

  /** @internal */
  exportArgs(): string;
} & VisibilityProperties<Visibility>;

/**
 * An HTTP action that is part of this app's public API.
 *
 * You can create public HTTP actions by wrapping your function in
 * {@link httpActionGeneric} and exporting it.
 *
 * @public
 */
export type PublicHttpAction = {
  (ctx: ActionCtx<any>, request: Request): Response;
  isHttp: true;
  isRegistered?: true;

  /** @internal */
  invokeHttpAction(request: Request): Promise<Response>;
};

/**
 * The definition of a Convex query, mutation, or action function without
 * argument validation.
 *
 * Convex functions always take a context object as their first argument
 * and an (optional) args object as their second argument.
 *
 * This can be written as a function like:
 * ```js
 * import { query } from "./_generated/server";
 *
 * export const func = query(({ db }, { arg }) => {...});
 * ```
 * or as an object like:
 *
 * ```js
 * import { query } from "./_generated/server";
 *
 * export const func = query({
 *   handler: ({ db }, { arg }) => {...},
 * });
 * ```
 * See {@link ValidatedFunction} to add argument validation.
 *
 * @public
 */
export type UnvalidatedFunction<Ctx, Args extends ArgsArray, Output> =
  | ((ctx: Ctx, ...args: Args) => Output)
  | {
      handler: (ctx: Ctx, ...args: Args) => Output;
    };

/**
 * The definition of a Convex query, mutation, or action function with argument
 * validation.
 *
 * Argument validation allows you to assert that the arguments to this function
 * are the expected type.
 *
 * Example:
 *
 * ```js
 * import { query } from "./_generated/server";
 * import { v } from "convex/values";
 *
 * export const func = query({
 *   args: {
 *     arg: v.string()
 *   },
 *   handler: ({ db }, { arg }) => {...},
 * });
 * ```
 *
 * **For security, argument validation should be added to all public functions in
 * production apps.**
 *
 * See {@link UnvalidatedFunction} for functions without argument validation.
 * @public
 */
export interface ValidatedFunction<
  Ctx,
  ArgsValidator extends PropertyValidators,
  Output
> {
  /**
   * A validator for the arguments of this function.
   *
   * This is an object mapping argument names to validators constructed with
   * {@link values.v}.
   *
   * ```js
   * import { v } from "convex/values";
   *
   * const args = {
   *   stringArg: v.string(),
   *   optionalNumberArg: v.optional(v.number()),
   * }
   * ```
   */
  args: ArgsValidator;

  /**
   * The implementation of this function.
   *
   * This is a function that takes in the appropriate context and arguments
   * and produces some result.
   *
   * @param ctx - The context object. This is one of {@link QueryCtx},
   * {@link MutationCtx}, or {@link ActionCtx} depending on the function type.
   * @param args - The arguments object for this function. This will match
   * the type defined by the argument validator.
   * @returns
   */
  handler: (ctx: Ctx, args: ObjectType<ArgsValidator>) => Output;
}

/**
 * Internal type helper used by Convex code generation.
 *
 * Used to give {@link mutationGeneric} a type specific to your data model.
 * @public
 */
export type MutationBuilder<
  DataModel extends GenericDataModel,
  API extends GenericAPI,
  Visibility extends FunctionVisibility
> = {
  <Output, ArgsValidator extends PropertyValidators>(
    func: ValidatedFunction<MutationCtx<DataModel, API>, ArgsValidator, Output>
  ): RegisteredMutation<Visibility, [ObjectType<ArgsValidator>], Output>;

  <Output, Args extends ArgsArray = OneArgArray>(
    func: UnvalidatedFunction<MutationCtx<DataModel, API>, Args, Output>
  ): RegisteredMutation<Visibility, Args, Output>;
};

/**
 * Internal type helper used by Convex code generation.
 *
 * Used to give {@link queryGeneric} a type specific to your data model.
 * @public
 */
export type QueryBuilder<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility
> = {
  <Output, ArgsValidator extends PropertyValidators>(
    func: ValidatedFunction<QueryCtx<DataModel>, ArgsValidator, Output>
  ): RegisteredQuery<Visibility, [ObjectType<ArgsValidator>], Output>;

  <Output, Args extends ArgsArray = OneArgArray>(
    func: UnvalidatedFunction<QueryCtx<DataModel>, Args, Output>
  ): RegisteredQuery<Visibility, Args, Output>;
};

/**
 * Internal type helper used by Convex code generation.
 *
 * Used to give {@link actionGeneric} a type specific to your data model.
 * @public
 */
export type ActionBuilder<
  API extends GenericAPI,
  Visibility extends FunctionVisibility
> = {
  <Output, ArgsValidator extends PropertyValidators>(
    func: ValidatedFunction<ActionCtx<API>, ArgsValidator, Output>
  ): RegisteredAction<Visibility, [ObjectType<ArgsValidator>], Output>;

  <Output, Args extends ArgsArray = OneArgArray>(
    func: UnvalidatedFunction<ActionCtx<API>, Args, Output>
  ): RegisteredAction<Visibility, Args, Output>;
};

/**
 * Internal type helper used by Convex code generation.
 *
 * Used to give {@link httpActionGeneric} a type specific to your data model
 * and functions.
 * @public
 */
export type HttpActionBuilderForAPI<API extends GenericAPI> = (
  func: (ctx: ActionCtx<API>, request: Request) => Promise<Response>
) => PublicHttpAction;
