/**
 * Utilities for implementing server-side Convex query and mutation functions.
 *
 * ## Usage
 *
 * ### Code Generation
 *
 * This module is typically used alongside generated server code.
 *
 * To generate the server code, run `npx convex dev` in your Convex project.
 * This will create a `convex/_generated/server.js` file with the following
 * functions, typed for your schema:
 * - [query](https://docs.convex.dev/generated-api/server#query)
 * - [mutation](https://docs.convex.dev/generated-api/server#mutation)
 *
 * If you aren't using TypeScript and code generation, you can use these untyped
 * functions instead:
 * - {@link queryGeneric}
 * - {@link mutationGeneric}
 *
 * ### Example
 *
 * Convex functions are defined by using either the `query` or
 * `mutation` wrappers.
 *
 * Queries receive a `db` that implements the {@link DatabaseReader} interface.
 *
 * ```js
 * import { query } from "./_generated/server";
 *
 * export default query(async ({ db }, { arg1, arg2 }) => {
 *   // Your (read-only) code here!
 * });
 * ```
 *
 * If your function needs to write to the database, such as inserting, updating,
 * or deleting documents, use `mutation` instead which provides a `db` that
 * implements the {@link DatabaseWriter} interface.
 *
 * ```js
 * import { mutation } from "./_generated/server";
 *
 * export default mutation(async ({ db }, { arg1, arg2 }) => {
 *   // Your mutation code here!
 * });
 * ```
 * @module
 */
export type { Auth, UserIdentity } from "./authentication.js";
export * from "./database.js";
export * from "./data_model.js";
export type {
  Expression,
  ExpressionOrValue,
  FilterBuilder,
} from "./filter_builder.js";
export {
  actionGeneric,
  httpActionGeneric,
  mutationGeneric,
  queryGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
} from "./impl/registration_impl.js";
export type { IndexRange, IndexRangeBuilder } from "./index_range_builder.js";
export * from "./pagination.js";
export type { OrderedQuery, Query, QueryInitializer } from "./query.js";
export type {
  ActionBuilder,
  ActionCtx,
  FunctionArgs,
  HttpActionBuilderForAPI,
  MutationBuilder,
  PublicHttpAction,
  MutationCtx,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery,
  QueryBuilder,
  QueryCtx,
  UnvalidatedFunction,
  ValidatedFunction,
} from "./registration.js";
export * from "./search_filter_builder.js";
export * from "./storage.js";
export type {
  Scheduler,
  SchedulableFunctionNames,
  NamedSchedulableFunction,
} from "./scheduler.js";
export { cronJobsGeneric } from "./cron.js";
export type { CronJob, CronJobsForAPI, Crons } from "./cron.js";
export type { WithoutSystemFields } from "./system_fields";
export { httpRouter, HttpRouter, ROUTABLE_HTTP_METHODS } from "./router.js";
export type { RoutableMethod } from "./router.js";
