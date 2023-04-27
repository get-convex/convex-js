/**
 * Utilities for working with values stored in Convex.
 *
 * You can see the full set of supported types at
 * [Types](https://docs.convex.dev/using/types).
 * @module
 */
import * as Base64 from "./base64.js";
import { isSimpleObject } from "../common/index.js";

const LITTLE_ENDIAN = true;
// This code is used by code that may not have bigint literals.
const MIN_INT64 = BigInt("-9223372036854775808");
const MAX_INT64 = BigInt("9223372036854775807");
const ZERO = BigInt("0");
const EIGHT = BigInt("8");
const TWOFIFTYSIX = BigInt("256");

/**
 * The type of JavaScript values serializable to JSON.
 *
 * @public
 */
export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };

/**
 * An identifier for a document in Convex.
 *
 * Convex documents are uniquely identified by their `Id`, which is accessible
 * on the `_id` field. To learn more, see [Data Modeling](https://docs.convex.dev/using/data-modeling).
 *
 * Documents can be loaded using `db.get(id)` in query and mutation functions.
 *
 * **Important**: Use `myId.equals(otherId)` to check for equality.
 * Using `===` will not work because two different instances of `Id` can refer
 * to the same document.
 *
 * `Id`s are 17 bytes long and consist of:
 * - A 15-byte random value.
 * - A 2-byte timestamp representing the document's creation, in days since the Unix epoch.
 * This is encoded in base 62 ([0-9A-Za-z]).
 *
 * If you're using code generation, use the `Id` class typed for your data model in
 * `convex/_generated/dataModel.js`.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 *
 * @public
 */
export class Id<TableName extends string> {
  /**
   * The table name this {@link GenericId} references.
   */
  public readonly tableName: TableName;

  /**
   * The identifier string.
   *
   * This contains the characters `[0-9A-Za-z]`.
   */
  public readonly id: string;

  constructor(tableName: TableName, id: string) {
    this.tableName = tableName;
    this.id = id;
  }

  /**
   * Check if this {@link GenericId} refers to the same document as another {@link GenericId}.
   *
   * @param other - The other {@link GenericId} to compare to.
   * @returns `true` if the objects refer to the same document.
   */
  equals(other: unknown): boolean {
    if (other instanceof Id) {
      return this.tableName === other.tableName && this.id === other.id;
    }
    return false;
  }

  /**
   * Parse a {@link GenericId} from its JSON representation.
   */
  static fromJSON(obj: any): Id<string> {
    if (typeof obj.$id !== "string") {
      throw new Error(
        `Object ${JSON.stringify(obj)} isn't a valid Id: $id isn't a string.`
      );
    }
    const parts = obj.$id.split("|");
    if (parts.length !== 2) {
      throw new Error(
        `Object ${JSON.stringify(obj)} isn't a valid Id: Wrong number of parts.`
      );
    }
    return new Id(parts[0], parts[1]);
  }

  /**
   * Convert a {@link GenericId} into its JSON representation.
   */
  toJSON(): JSONValue {
    const idString = `${this.tableName}|${this.id}`;
    return { $id: idString };
  }

  /**
   * Convert a {@link GenericId} into its string representation.
   *
   * This includes the identifier but not the table name.
   */
  toString(): string {
    return this.id;
  }

  /**
   * Pretty-print this {@link GenericId} for debugging.
   */
  inspect(): string {
    return `Id('${this.tableName}', '${this.id}')`;
  }
}

/**
 * Internal type used in Convex code generation.
 *
 * @public
 */
export type GenericIdConstructor<TableNames extends string> = {
  new <TableName extends TableNames>(
    tableName: TableName,
    id: string
  ): Id<TableName>;
  prototype: Id<string>;
  fromJSON(obj: any): Id<string>;
};

/**
 * A value supported by Convex.
 *
 * Values can be:
 * - stored inside of documents.
 * - used as arguments and return types to queries and mutation functions.
 *
 * You can see the full set of supported types at
 * [Types](https://docs.convex.dev/using/types).
 *
 * @public
 */
export type Value =
  | Id<string>
  | null
  | bigint
  | number
  | boolean
  | string
  | ArrayBuffer
  | Value[]
  | Set<Value>
  | Map<Value, Value>
  | { [key: string]: undefined | Value };

/**
 * The types of {@link Value} that can be used to represent numbers.
 *
 * @public
 */
export type NumericValue = bigint | number;

function isSpecial(n: number) {
  return Number.isNaN(n) || !Number.isFinite(n) || Object.is(n, -0);
}

export function slowBigIntToBase64(value: bigint): string {
  // the conversion is easy if we pretend it's unsigned
  if (value < ZERO) {
    value -= MIN_INT64 + MIN_INT64;
  }
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = "0" + hex;

  const bytes = new Uint8Array(new ArrayBuffer(8));
  let i = 0;
  for (const hexByte of hex.match(/.{2}/g)!.reverse()) {
    bytes.set([parseInt(hexByte, 16)], i++);
    value >>= EIGHT;
  }
  return Base64.fromByteArray(bytes);
}

export function slowBase64ToBigInt(encoded: string): bigint {
  const integerBytes = Base64.toByteArray(encoded);
  if (integerBytes.byteLength !== 8) {
    throw new Error(
      `Received ${integerBytes.byteLength} bytes, expected 8 for $integer`
    );
  }
  let value = ZERO;
  let power = ZERO;
  for (const byte of integerBytes) {
    value += BigInt(byte) * TWOFIFTYSIX ** power;
    power++;
  }
  if (value > MAX_INT64) {
    value += MIN_INT64 + MIN_INT64;
  }
  return value;
}

export function modernBigIntToBase64(value: bigint): string {
  if (value < MIN_INT64 || MAX_INT64 < value) {
    throw new Error(
      `BigInt ${value} does not fit into a 64-bit signed integer.`
    );
  }
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigInt64(0, value, true);
  return Base64.fromByteArray(new Uint8Array(buffer));
}

export function modernBase64ToBigInt(encoded: string): bigint {
  const integerBytes = Base64.toByteArray(encoded);
  if (integerBytes.byteLength !== 8) {
    throw new Error(
      `Received ${integerBytes.byteLength} bytes, expected 8 for $integer`
    );
  }
  const intBytesView = new DataView(integerBytes.buffer);
  return intBytesView.getBigInt64(0, true);
}

// Fall back to a slower version on Safari 14 which lacks these APIs.
export const bigIntToBase64 = (DataView.prototype as any).setBigInt64
  ? modernBigIntToBase64
  : slowBigIntToBase64;
export const base64ToBigInt = (DataView.prototype as any).getBigInt64
  ? modernBase64ToBigInt
  : slowBase64ToBigInt;

const MAX_IDENTIFIER_LEN = 64;
const ALL_UNDERSCORES = /^_+$/;
const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

function validateObjectField(k: string) {
  if (k.length === 0) {
    throw new Error("Empty field names are disallowed.");
  }
  if (k.length > MAX_IDENTIFIER_LEN) {
    throw new Error(
      `Field name ${k} exceeds maximum field name length ${MAX_IDENTIFIER_LEN}.`
    );
  }
  if (k.startsWith("$")) {
    throw new Error(`Field name ${k} starts with a '$', which is reserved.`);
  }
  if (ALL_UNDERSCORES.test(k)) {
    throw new Error(`Field name ${k} can't exclusively be underscores.`);
  }
  if (!IDENTIFIER_REGEX.test(k)) {
    throw new Error(
      `Field name ${k} must only contain alphanumeric characters or underscores and can't start with a number.`
    );
  }
}

function jsonToConvexInternal(value: JSONValue): Value {
  if (value === null) {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(jsonToConvexInternal);
  }
  if (typeof value !== "object") {
    throw new Error(`Unexpected type of ${value}`);
  }
  const entries = Object.entries(value);
  if (entries.length === 1) {
    const key = entries[0][0];
    if (key === "$id" || key === "$weakRef" || key === "$strongRef") {
      return Id.fromJSON(value);
    }
    if (key === "$bytes") {
      if (typeof value.$bytes !== "string") {
        throw new Error(`Malformed $bytes field on ${value}`);
      }
      return Base64.toByteArray(value.$bytes).buffer;
    }
    if (key === "$integer") {
      if (typeof value.$integer !== "string") {
        throw new Error(`Malformed $integer field on ${value}`);
      }
      return base64ToBigInt(value.$integer);
    }
    if (key === "$float") {
      if (typeof value.$float !== "string") {
        throw new Error(`Malformed $float field on ${value}`);
      }
      const floatBytes = Base64.toByteArray(value.$float);
      if (floatBytes.byteLength !== 8) {
        throw new Error(
          `Received ${floatBytes.byteLength} bytes, expected 8 for $float`
        );
      }
      const floatBytesView = new DataView(floatBytes.buffer);
      const float = floatBytesView.getFloat64(0, LITTLE_ENDIAN);
      if (!isSpecial(float)) {
        throw new Error(`Float ${float} should be encoded as a number`);
      }
      return float;
    }
    if (key === "$set") {
      if (!Array.isArray(value.$set)) {
        throw new Error(`Malformed $set field on ${value}`);
      }
      return new Set(value.$set.map(jsonToConvexInternal));
    }
    if (key === "$map") {
      if (!Array.isArray(value.$map)) {
        throw new Error(`Malformed $map field on ${value}`);
      }
      const map = new Map();
      for (const pair of value.$map) {
        if (!Array.isArray(pair) || pair.length !== 2) {
          throw new Error(`Malformed pair in $map ${value}`);
        }
        const k = jsonToConvexInternal(pair[0]);
        const v = jsonToConvexInternal(pair[1]);
        map.set(k, v);
      }
      return map;
    }
  }
  const out: { [key: string]: Value } = {};
  for (const [k, v] of Object.entries(value)) {
    validateObjectField(k);
    out[k] = jsonToConvexInternal(v);
  }
  return out;
}

/**
 * Parse a Convex value from its JSON representation.
 *
 * This function will revive classes like {@link GenericId} that have been serialized to JSON, parse out `BigInt`s, and so on.
 *
 * To learn more about Convex values, see [Types](https://docs.convex.dev/using/types).
 *
 * @param value - The JSON representation of a Convex value previously created with {@link convexToJson}.
 * @returns The JavaScript representation of the Convex value.
 *
 * @public
 */
export function jsonToConvex(value: JSONValue): Value {
  return jsonToConvexInternal(value);
}

function stringifyValueForError(value: any) {
  return JSON.stringify(value, (_key, value) => {
    if (value === undefined) {
      // By default `JSON.stringify` converts undefined, functions, symbols,
      // Infinity, and NaN to null which produces a confusing error message.
      // We deal with `undefined` specifically because it's the most common.
      // Ideally we'd use a pretty-printing library that prints `undefined`
      // (no quotes), but it might not be worth the bundle size cost.
      return "undefined";
    }
    if (typeof value === "bigint") {
      // `JSON.stringify` throws on bigints by default.
      return `${value.toString()}n`;
    }
    return value;
  });
}

function convexToJsonInternal(
  value: Value,
  originalValue: Value,
  context: string
): JSONValue {
  if (value === undefined) {
    const contextText =
      context &&
      ` (present at path ${context} in original object ${stringifyValueForError(
        originalValue
      )})`;
    throw new Error(
      `undefined is not a valid Convex value${contextText}. To learn about Convex's supported types, see https://docs.convex.dev/using/types.`
    );
  }
  if (value === null) {
    return value;
  }
  if (value instanceof Id) {
    return value.toJSON();
  }
  if (typeof value === "bigint") {
    if (value < MIN_INT64 || MAX_INT64 < value) {
      throw new Error(
        `BigInt ${value} does not fit into a 64-bit signed integer.`
      );
    }
    return { $integer: bigIntToBase64(value) };
  }
  if (typeof value === "number") {
    if (isSpecial(value)) {
      const buffer = new ArrayBuffer(8);
      new DataView(buffer).setFloat64(0, value, LITTLE_ENDIAN);
      return { $float: Base64.fromByteArray(new Uint8Array(buffer)) };
    } else {
      return value;
    }
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return { $bytes: Base64.fromByteArray(new Uint8Array(value)) };
  }
  if (Array.isArray(value)) {
    return value.map((value, i) =>
      convexToJsonInternal(value, originalValue, context + `[${i}]`)
    );
  }
  if (value instanceof Set) {
    return {
      $set: [...value].map((value, i) =>
        convexToJsonInternal(value, originalValue, context + `.keys()[${i}]`)
      ),
    };
  }
  if (value instanceof Map) {
    return {
      $map: [...value].map(([k, v], i) => {
        const jsonKey = convexToJsonInternal(
          k,
          originalValue,
          context + `.keys()[${i}]`
        );
        const jsonValue = convexToJsonInternal(
          v,
          originalValue,
          context + `.values()[${i}]`
        );
        return [jsonKey, jsonValue];
      }),
    };
  }

  if (!isSimpleObject(value)) {
    const theType = value?.constructor?.name;
    const typeMsg = theType ? `${theType} ` : "";
    if (context) {
      throw new Error(
        `${typeMsg}${stringifyValueForError(
          value
        )} is not a supported Convex type (present at path ${context} in original object ${stringifyValueForError(
          originalValue
        )}). To learn about Convex's supported types, see https://docs.convex.dev/using/types.`
      );
    } else {
      throw new Error(
        `${typeMsg}${stringifyValueForError(
          value
        )} is not a supported Convex type.`
      );
    }
  }

  const out: { [key: string]: JSONValue } = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) {
      validateObjectField(k);
      out[k] = convexToJsonInternal(v, originalValue, context + `.${k}`);
    }
  }
  return out;
}

/**
 * Convert a Convex value to its JSON representation.
 *
 * Use {@link jsonToConvex} to recreate the original value.
 *
 * To learn more about Convex values, see [Types](https://docs.convex.dev/using/types).
 *
 * @param value - A Convex value to convert into JSON.
 * @returns The JSON representation of `value`.
 *
 * @public
 */
export function convexToJson(value: Value): JSONValue {
  return convexToJsonInternal(value, value, "");
}
