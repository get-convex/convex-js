/**
 * Utilities for working with values stored in Convex.
 *
 * You can see the full set of supported types at
 * [Types](https://docs.convex.dev/using/types).
 * @module
 */

export { Id as GenericId, convexToJson, jsonToConvex } from "./value.js";
export type {
  GenericIdConstructor,
  JSONValue,
  Value,
  NumericValue,
} from "./value.js";
export { v, Validator } from "./validator.js";
export type { PropertyValidators, ObjectType } from "./validator.js";
import * as Base64 from "./base64.js";
export { Base64 };
export type { Infer } from "./validator.js";
