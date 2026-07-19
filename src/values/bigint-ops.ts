/**
 * BigInt operations abstraction layer.
 *
 * Provides unified interface for both native BigInt and JSBI polyfill.
 * All BigInt operations in the codebase must route through this layer.
 */

// Type representing either native bigint or JSBI instance
export type BigIntValue = bigint;

export interface BigIntOps {
  // Creation
  from(value: number | string | bigint): BigIntValue;

  // Comparison
  lessThan(a: BigIntValue, b: BigIntValue): boolean;
  lessThanOrEqual(a: BigIntValue, b: BigIntValue): boolean;
  greaterThan(a: BigIntValue, b: BigIntValue): boolean;
  equal(a: BigIntValue, b: BigIntValue): boolean;
  notEqual(a: BigIntValue, b: BigIntValue): boolean;

  // Arithmetic
  add(a: BigIntValue, b: BigIntValue): BigIntValue;
  subtract(a: BigIntValue, b: BigIntValue): BigIntValue;
  multiply(a: BigIntValue, b: BigIntValue): BigIntValue;

  // Bitwise
  bitwiseAnd(a: BigIntValue, b: BigIntValue): BigIntValue;
  leftShift(value: BigIntValue, shift: BigIntValue): BigIntValue;
  rightShift(value: BigIntValue, shift: BigIntValue): BigIntValue;
  exponentiate(base: BigIntValue, exponent: BigIntValue): BigIntValue;
}

// Native BigInt implementation
const nativeOps: BigIntOps = {
  from: (value: number | string | bigint): bigint =>
    typeof value === "bigint" ? value : BigInt(value),

  lessThan: (a: bigint, b: bigint): boolean => a < b,
  lessThanOrEqual: (a: bigint, b: bigint): boolean => a <= b,
  greaterThan: (a: bigint, b: bigint): boolean => a > b,
  equal: (a: bigint, b: bigint): boolean => a === b,
  notEqual: (a: bigint, b: bigint): boolean => a !== b,

  add: (a: bigint, b: bigint): bigint => a + b,
  subtract: (a: bigint, b: bigint): bigint => a - b,
  multiply: (a: bigint, b: bigint): bigint => a * b,

  bitwiseAnd: (a: bigint, b: bigint): bigint => a & b,
  leftShift: (value: bigint, shift: bigint): bigint => value << shift,
  rightShift: (value: bigint, shift: bigint): bigint => value >> shift,
  exponentiate: (base: bigint, exponent: bigint): bigint => base ** exponent,
};

// Export the native implementation
// In polyfill build, this file will be replaced with JSBI variant
export const BI: BigIntOps = nativeOps;

// Commonly used constants
export const ZERO = BI.from(0);
export const EIGHT = BI.from(8);
export const TWOFIFTYSIX = BI.from(256);
export const MIN_INT64 = BI.from("-9223372036854775808");
export const MAX_INT64 = BI.from("9223372036854775807");
export const BIT_63 = BI.from("0x8000000000000000");
