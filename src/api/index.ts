/**
 * All of the utility types to describe a Convex API of queries and mutations
 */

import { ArgsArray } from "../server/registration.js";
import { Expand, PickByValue, UnionToIntersection } from "../type_utils.js";
import { Value } from "../values/value.js";

/**
 * The type of a Convex function in a {@link GenericAPI}.
 *
 * @public
 */
export type ConvexFunction = (args?: any) => any;

/**
 * Description of the Convex functions available to an application.
 *
 * This is a generic type that expresses the shape of API types created by
 * `npx convex dev`. It's used to make the Convex clients type-safe.
 *
 * @public
 */
export type GenericAPI = {
  publicQueries: Record<string, ConvexFunction>;
  allQueries: Record<string, ConvexFunction>;
  publicMutations: Record<string, ConvexFunction>;
  allMutations: Record<string, ConvexFunction>;
  publicActions: Record<string, ConvexFunction>;
  allActions: Record<string, ConvexFunction>;
};

/**
 * Helper types for interacting with the overall API type
 */

/**
 * The names of query functions in a Convex API.
 *
 * @public
 */
export type QueryNames<API extends GenericAPI> = keyof API["allQueries"] &
  string;

/**
 * The names of public query functions in a Convex API.
 *
 * @public
 */
export type PublicQueryNames<API extends GenericAPI> =
  keyof API["publicQueries"] & string;

/**
 * The names of mutation functions in a Convex API.
 *
 * @public
 */
export type MutationNames<API extends GenericAPI> = keyof API["allMutations"] &
  string;

/**
 * The names of public mutation functions in a Convex API.
 *
 * @public
 */
export type PublicMutationNames<API extends GenericAPI> =
  keyof API["publicMutations"] & string;

/**
 * The names of actions in a Convex API.
 *
 * @public
 */
export type ActionNames<API extends GenericAPI> = keyof API["allActions"] &
  string;

/**
 * The names of public query functions in a Convex API.
 *
 * @public
 */
export type PublicActionNames<API extends GenericAPI> =
  keyof API["publicActions"] & string;
/**
 * The type of a query function in a Convex API.
 *
 * @public
 */
export type NamedQuery<
  API extends GenericAPI,
  Name extends QueryNames<API>
> = API["allQueries"][Name];

/**
 * The type of a mutation function in a Convex API.
 *
 * @public
 */
export type NamedMutation<
  API extends GenericAPI,
  Name extends MutationNames<API>
> = API["allMutations"][Name];

/**
 * The type of an action in a Convex API.
 *
 * @public
 */
export type NamedAction<
  API extends GenericAPI,
  Name extends ActionNames<API>
> = API["allActions"][Name];

/**
 * The type of the arguments to a Convex function.
 *
 * This is represented as a single object mapping argument names to values.
 * Functions that don't need any arguments object are represented as `{}`.
 * @public
 */
export type ArgsObject<F extends (args?: Record<string, Value>) => any> =
  Parameters<F>["length"] extends 0
    ? // eslint-disable-next-line @typescript-eslint/ban-types
      {}
    : Parameters<F>[0] & Record<string, Value>;

/**
 * An tuple type of the (maybe optional) arguments to `F`.
 *
 * This type is used to make methods involving arguments type safe while allowing
 * skipping the arguments for functions that don't require arguments.
 *
 * @public
 */
export type OptionalRestArgs<F extends (args?: Record<string, Value>) => any> =
  Parameters<F>["length"] extends 0
    ? // eslint-disable-next-line @typescript-eslint/ban-types
      [args?: {}]
    : [args: Parameters<F>[0]];

/**
 * A tuple type of the (maybe optional) arguments to `F`, followed by an options
 * object of type `Options`.
 *
 * This type is used to make methods like `useQuery` type-safe while allowing
 * 1. Skipping arguments for functions that don't require arguments.
 * 2. Skipping the options object.
 * @public
 */
export type ArgsAndOptions<
  F extends (args?: Record<string, Value>) => any,
  Options
> = Parameters<F>["length"] extends 0
  ? // eslint-disable-next-line @typescript-eslint/ban-types
    [args?: {}, options?: Options]
  : [args: Parameters<F>[0], options?: Options];

/**
 * Internal Codegen Type Helpers
 */

/**
 * Generate the fully-qualified query/mutation name of an export.
 *
 * This is `path/to/module:export` or `path/to/module` for the default export.
 */
type FunctionName<
  FilePath extends string,
  ExportName extends string
> = ExportName extends "default" ? FilePath : `${FilePath}:${ExportName}`;

/**
 * Generate a type of this module where each export is renamed to its
 * fully-qualified {@link FunctionName}.
 */
type NameModule<FilePath extends string, Module extends Record<string, any>> = {
  [ExportName in keyof Module as FunctionName<
    FilePath,
    ExportName & string
  >]: Module[ExportName];
};

/**
 * Name and merge together all of the exports in the `convex/` directory into
 * a flat object type.
 */
type MergeAllExports<Modules extends Record<string, Record<string, any>>> =
  UnionToIntersection<
    {
      [FilePath in keyof Modules]: NameModule<
        FilePath & string,
        Modules[FilePath]
      >;
    }[keyof Modules]
  >;

type UndefinedToNull<T> = T extends void ? null : T;

/**
 * If this function has an argument, name it `args` so it's pretty in editors.
 */
type NameArgs<Args extends ArgsArray> = Args["length"] extends 0
  ? []
  : [args: Args[0]];

/**
 * Converts a map of query and mutation types into their client form.
 *
 * This is done by:
 * - Unwrapping `Promise` if it's in the output.
 * - Switching functions that output `undefined` to `null`.
 *
 */
type ConvertToClientFunctions<FunctionsByName extends Record<string, any>> = {
  [Name in keyof FunctionsByName]: (
    ...args: NameArgs<FunctionsByName[Name]["args"]>
  ) => UndefinedToNull<Awaited<FunctionsByName[Name]["output"]>>;
};

/**
 * Create the API type from the types of all of the modules.
 *
 * Input is an object mapping file paths to the type of each module.
 *
 * For internal use by Convex code generation.
 *
 * @public
 */
export type ApiFromModules<
  Modules extends Record<string, Record<string, any>>
> = {
  publicQueries: Expand<
    ConvertToClientFunctions<
      PickByValue<MergeAllExports<Modules>, { isQuery: true; isPublic: true }>
    >
  >;
  allQueries: Expand<
    ConvertToClientFunctions<
      PickByValue<MergeAllExports<Modules>, { isQuery: true }>
    >
  >;
  publicMutations: Expand<
    ConvertToClientFunctions<
      PickByValue<
        MergeAllExports<Modules>,
        { isMutation: true; isPublic: true }
      >
    >
  >;
  allMutations: Expand<
    ConvertToClientFunctions<
      PickByValue<MergeAllExports<Modules>, { isMutation: true }>
    >
  >;
  publicActions: Expand<
    ConvertToClientFunctions<
      PickByValue<MergeAllExports<Modules>, { isAction: true; isPublic: true }>
    >
  >;
  allActions: Expand<
    ConvertToClientFunctions<
      PickByValue<MergeAllExports<Modules>, { isAction: true }>
    >
  >;
};
