import { Value } from "../../values";

/**
 * The result of running a function on the server.
 *
 * If the function hit an exception it will have an `errorMessage`. Otherwise
 * it will produce a `Value`.
 *
 * @public
 */
export type FunctionResult =
  | {
      success: true;
      value: Value;
      logLines: string[];
    }
  | { success: false; errorMessage: string; logLines: string[] };
