import type { Value } from "../values/value.js";

export const STATUS_CODE_OK = 200;

export const STATUS_CODE_BAD_REQUEST = 400;

// Special custom 5xx HTTP status code to mean that the UDF returned an error.
//
// Must match the constant of the same name in Rust.
export const STATUS_CODE_UDF_FAILED = 560;

/**
 * Validate that the arguments to a Convex function are an object, defaulting
 * `undefined` to `{}`.
 */
export function parseArgs(
  args: Record<string, Value> | undefined
): Record<string, Value> {
  if (args === undefined) {
    return {};
  }
  if (!isSimpleObject(args)) {
    throw new Error(
      `The arguments to a Convex function must be an object. Received: ${args}`
    );
  }
  return args;
}

/**
 * Check whether a value is a plain old JavaScript object.
 */
export function isSimpleObject(value: unknown) {
  const isObject = typeof value === "object";
  const prototype = Object.getPrototypeOf(value);
  const isSimple =
    prototype === null ||
    prototype === Object.prototype ||
    // Objects generated from other contexts (e.g. across Node.js `vm` modules) will not satisfy the previous
    // conditions but are still simple objects.
    prototype?.constructor?.name === "Object";
  return isObject && isSimple;
}
