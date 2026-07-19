/**
 * BigInt operations abstraction layer - JSBI POLYFILL VARIANT.
 *
 * This is the polyfill version that uses JSBI for environments without native BigInt.
 * Gets swapped in during polyfill build process.
 */

import JSBI from "jsbi";

// Type representing JSBI instance
export type BigIntValue = JSBI;

export interface BigIntOps {
  from(value: number | string | bigint): BigIntValue;
  lessThan(a: BigIntValue, b: BigIntValue): boolean;
  lessThanOrEqual(a: BigIntValue, b: BigIntValue): boolean;
  greaterThan(a: BigIntValue, b: BigIntValue): boolean;
  equal(a: BigIntValue, b: BigIntValue): boolean;
  notEqual(a: BigIntValue, b: BigIntValue): boolean;
  add(a: BigIntValue, b: BigIntValue): BigIntValue;
  subtract(a: BigIntValue, b: BigIntValue): BigIntValue;
  multiply(a: BigIntValue, b: BigIntValue): BigIntValue;
  bitwiseAnd(a: BigIntValue, b: BigIntValue): BigIntValue;
  leftShift(value: BigIntValue, shift: BigIntValue): BigIntValue;
  rightShift(value: BigIntValue, shift: BigIntValue): BigIntValue;
  exponentiate(base: BigIntValue, exponent: BigIntValue): BigIntValue;
}

// JSBI implementation
const jsbiOps: BigIntOps = {
  from: (value: number | string | bigint): JSBI =>
    typeof value === "bigint" ? JSBI.BigInt(String(value)) : JSBI.BigInt(value),

  lessThan: (a: JSBI, b: JSBI): boolean => JSBI.lessThan(a, b),
  lessThanOrEqual: (a: JSBI, b: JSBI): boolean => JSBI.lessThanOrEqual(a, b),
  greaterThan: (a: JSBI, b: JSBI): boolean => JSBI.greaterThan(a, b),
  equal: (a: JSBI, b: JSBI): boolean => JSBI.equal(a, b),
  notEqual: (a: JSBI, b: JSBI): boolean => JSBI.notEqual(a, b),

  add: (a: JSBI, b: JSBI): JSBI => JSBI.add(a, b),
  subtract: (a: JSBI, b: JSBI): JSBI => JSBI.subtract(a, b),
  multiply: (a: JSBI, b: JSBI): JSBI => JSBI.multiply(a, b),

  bitwiseAnd: (a: JSBI, b: JSBI): JSBI => JSBI.bitwiseAnd(a, b),
  leftShift: (value: JSBI, shift: JSBI): JSBI => JSBI.leftShift(value, shift),
  rightShift: (value: JSBI, shift: JSBI): JSBI =>
    JSBI.signedRightShift(value, shift),
  exponentiate: (base: JSBI, exponent: JSBI): JSBI =>
    JSBI.exponentiate(base, exponent),
};

// Export the JSBI implementation
export const BI: BigIntOps = jsbiOps;

// Commonly used constants
export const ZERO = BI.from(0);
export const EIGHT = BI.from(8);
export const TWOFIFTYSIX = BI.from(256);
export const MIN_INT64 = BI.from("-9223372036854775808");
export const MAX_INT64 = BI.from("9223372036854775807");
export const BIT_63 = BI.from("0x8000000000000000");
