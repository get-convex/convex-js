import {
  ActionNames,
  GenericAPI,
  MutationNames,
  NamedAction,
  NamedMutation,
  OptionalRestArgs,
} from "../browser";

/**
 * The names of all of the schedulable in a Convex API.
 *
 * These are all of the mutations and actions.
 *
 * @public
 */
export type SchedulableFunctionNames<API extends GenericAPI> =
  | ActionNames<API>
  | MutationNames<API>;

/**
 * The type of a schedulable function in a Convex API.
 *
 * @public
 */
export type NamedSchedulableFunction<
  API extends GenericAPI,
  Name extends SchedulableFunctionNames<API>
> = Name extends ActionNames<API>
  ? NamedAction<API, Name>
  : NamedMutation<API, Name>;

/**
 * An interface to schedule Convex functions.
 *
 * You can schedule either mutations or actions. Mutations are guaranteed to execute
 * exactly once - they are automatically retried on transient errors and either execute
 * successfully or fail deterministically due to developer error in defining the
 * function. Actions execute at most once - they are not retried and might fail
 * due to transient errors.
 *
 * Consider using an {@link internalMutation} or {@link internalAction} to enforce that
 * these functions cannot be called directly from a Convex client.
 *
 * @public
 */
export interface Scheduler<API extends GenericAPI> {
  /**
   * Schedule a function to execute after a delay.
   *
   * @param delayMs - delay in milliseconds. Must be non-negative. If the delay
   * is zero, the scheduled function will be due to execute immediately after the
   * scheduling one completes.
   * @param name - the name of the function to schedule.
   * @param args - arguments to call the scheduled functions with.
   **/
  runAfter<Name extends SchedulableFunctionNames<API>>(
    delayMs: number,
    name: Name,
    ...args: OptionalRestArgs<NamedSchedulableFunction<API, Name>>
  ): Promise<void>;

  /**
   * Schedule a function to execute at a given timestamp.
   *
   * @param timestamp - a Date or a timestamp (milliseconds since the epoch).
   * If the timestamp is in the past, the scheduled function will be due to
   * execute immediately after the scheduling one completes. The timestamp can't
   * be more than five years in the past or more than five years in the future.
   * @param name - the name of the function to schedule.
   * @param args - arguments to call the scheduled functions with.
   **/
  runAt<Name extends SchedulableFunctionNames<API>>(
    timestamp: number | Date,
    name: Name,
    ...args: OptionalRestArgs<NamedSchedulableFunction<API, Name>>
  ): Promise<void>;
}
