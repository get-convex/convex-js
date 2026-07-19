import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Long } from "./long.js";

describe("Long", () => {
  describe("constructor", () => {
    it("creates Long from low and high parts", () => {
      const long = new Long(0x12345678, 0xabcdef00);
      expect(long.low).toBe(0x12345678 | 0);
      expect(long.high).toBe(0xabcdef00 | 0);
      expect(long.__isUnsignedLong__).toBe(true);
    });

    it("handles signed 32-bit overflow", () => {
      const long = new Long(0xffffffff, 0x7fffffff);
      expect(long.low).toBe(-1); // 0xffffffff as signed
      expect(long.high).toBe(0x7fffffff);
    });
  });

  describe("isLong", () => {
    it("returns true for Long instances", () => {
      const long = new Long(1, 2);
      expect(Long.isLong(long)).toBe(true);
    });

    it("returns false for non-Long objects", () => {
      expect(Long.isLong({})).toBe(false);
      expect(Long.isLong({ low: 1, high: 2 })).toBe(false);
      expect(Long.isLong(null)).toBe(false);
      expect(Long.isLong(undefined)).toBe(false);
    });
  });

  describe("fromBytesLE", () => {
    it("creates Long from little-endian bytes", () => {
      const bytes = [0x78, 0x56, 0x34, 0x12, 0x00, 0xef, 0xcd, 0xab];
      const long = Long.fromBytesLE(bytes);
      // Stored as signed 32-bit via | 0
      expect(long.low).toBe(0x12345678 | 0);
      expect(long.high).toBe((0xabcdef00 | 0));
    });

    it("handles zero", () => {
      const bytes = [0, 0, 0, 0, 0, 0, 0, 0];
      const long = Long.fromBytesLE(bytes);
      expect(long.low).toBe(0);
      expect(long.high).toBe(0);
    });

    it("handles max unsigned 64-bit", () => {
      const bytes = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
      const long = Long.fromBytesLE(bytes);
      expect(long.low).toBe(-1); // 0xffffffff as signed
      expect(long.high).toBe(-1);
    });
  });

  describe("toBytesLE", () => {
    it("converts Long to little-endian bytes", () => {
      const long = new Long(0x12345678, 0xabcdef00);
      const bytes = long.toBytesLE();
      expect(bytes).toEqual([0x78, 0x56, 0x34, 0x12, 0x00, 0xef, 0xcd, 0xab]);
    });

    it("round-trips with fromBytesLE", () => {
      const original = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0];
      const long = Long.fromBytesLE(original);
      const bytes = long.toBytesLE();
      expect(bytes).toEqual(original);
    });
  });

  describe("fromNumber", () => {
    it("converts small numbers", () => {
      const long = Long.fromNumber(12345);
      expect(long.low).toBe(12345);
      expect(long.high).toBe(0);
    });

    it("converts large numbers (> 2^32)", () => {
      const long = Long.fromNumber(0x100000000 + 0x12345678);
      expect(long.low).toBe(0x12345678);
      expect(long.high).toBe(1);
    });

    it("handles zero", () => {
      const long = Long.fromNumber(0);
      expect(long.low).toBe(0);
      expect(long.high).toBe(0);
    });

    it("handles NaN", () => {
      const long = Long.fromNumber(NaN);
      expect(long.low).toBe(0);
      expect(long.high).toBe(0);
    });

    it("clamps negative to zero", () => {
      const long = Long.fromNumber(-100);
      expect(long.low).toBe(0);
      expect(long.high).toBe(0);
    });

    it("clamps overflow to max", () => {
      // TWO_PWR_64_DBL = 2^64 = 18446744073709551616
      const long = Long.fromNumber(2 ** 64);
      // MAX_UNSIGNED_VALUE is 0xffffffff for both low and high (stored as -1)
      expect(long.low).toBe(-1);
      expect(long.high).toBe(-1);
    });
  });

  describe("toString", () => {
    describe("with native BigInt", () => {
      it("converts small numbers", () => {
        const long = new Long(12345, 0);
        expect(long.toString()).toBe("12345");
      });

      it("converts zero", () => {
        const long = new Long(0, 0);
        expect(long.toString()).toBe("0");
      });

      it("converts numbers > 2^32", () => {
        const long = new Long(0x12345678, 1);
        const expected = (BigInt(1) * BigInt(0x100000000) + BigInt(0x12345678)).toString();
        expect(long.toString()).toBe(expected);
      });

      it("converts max unsigned 64-bit", () => {
        const long = new Long(0xffffffff, 0xffffffff);
        // 2^64 - 1 = 18446744073709551615
        expect(long.toString()).toBe("18446744073709551615");
      });

      it("handles various powers of 2", () => {
        expect(new Long(0, 1).toString()).toBe("4294967296"); // 2^32
        expect(new Long(0, 0x10000).toString()).toBe("281474976710656"); // 2^48
      });
    });

    describe("without native BigInt (polyfill)", () => {
      let originalBigInt: any;

      beforeEach(() => {
        originalBigInt = (globalThis as any).BigInt;
        (globalThis as any).BigInt = undefined;
      });

      afterEach(() => {
        (globalThis as any).BigInt = originalBigInt;
      });

      it("converts small numbers", () => {
        const long = new Long(12345, 0);
        expect(long.toString()).toBe("12345");
      });

      it("converts zero", () => {
        const long = new Long(0, 0);
        expect(long.toString()).toBe("0");
      });

      it("converts numbers > 2^32", () => {
        const long = new Long(0x12345678, 1);
        // 1 * 2^32 + 0x12345678 = 4294967296 + 305419896 = 4600387192
        expect(long.toString()).toBe("4600387192");
      });

      it("converts max unsigned 64-bit", () => {
        const long = new Long(0xffffffff, 0xffffffff);
        // Should still get correct string without BigInt
        expect(long.toString()).toBe("18446744073709551615");
      });

      it("handles various edge cases", () => {
        // 2^32 exactly
        expect(new Long(0, 1).toString()).toBe("4294967296");

        // 2^32 - 1 (max 32-bit unsigned)
        expect(new Long(-1, 0).toString()).toBe("4294967295"); // 0xffffffff stored as -1

        // High only
        expect(new Long(0, 0xabcdef).toString()).toBe("48358647398400000");

        // Both parts
        expect(new Long(0x12345678, 0xabcdef).toString()).toBe("48358647703819896");
      });

      it("matches native BigInt results", () => {
        // Restore BigInt temporarily to compare
        (globalThis as any).BigInt = originalBigInt;

        const testCases: Array<[number, number]> = [
          [0, 0],
          [1, 0],
          [0xffffffff, 0], // Will be stored as -1 (signed), but toString uses >>> 0
          [0, 1],
          [0x12345678, 0xabcdef00],
          [0xffffffff, 0xffffffff],
        ];

        testCases.forEach(([low, high]) => {
          const long = new Long(low, high);
          const withBigInt = long.toString();

          // Remove BigInt again
          (globalThis as any).BigInt = undefined;
          const withoutBigInt = long.toString();

          expect(withoutBigInt).toBe(withBigInt);

          // Restore for next iteration
          (globalThis as any).BigInt = originalBigInt;
        });
      });
    });
  });

  describe("equals", () => {
    it("returns true for equal Longs", () => {
      const a = new Long(123, 456);
      const b = new Long(123, 456);
      expect(a.equals(b)).toBe(true);
    });

    it("returns false for different lows", () => {
      const a = new Long(123, 456);
      const b = new Long(999, 456);
      expect(a.equals(b)).toBe(false);
    });

    it("returns false for different highs", () => {
      const a = new Long(123, 456);
      const b = new Long(123, 999);
      expect(a.equals(b)).toBe(false);
    });

    it("handles non-Long via fromValue", () => {
      const a = new Long(123, 456);
      const b = { low: 123, high: 456 };
      expect(a.equals(b as any)).toBe(true);
    });

    it("returns false for negative high bits", () => {
      const a = new Long(123, 0x80000000); // High bit set
      const b = new Long(123, 0x80000000);
      expect(a.equals(b)).toBe(false); // Both have high bit set
    });
  });

  describe("notEquals", () => {
    it("returns false for equal Longs", () => {
      const a = new Long(123, 456);
      const b = new Long(123, 456);
      expect(a.notEquals(b)).toBe(false);
    });

    it("returns true for different Longs", () => {
      const a = new Long(123, 456);
      const b = new Long(999, 456);
      expect(a.notEquals(b)).toBe(true);
    });
  });

  describe("comp", () => {
    it("returns 0 for equal values", () => {
      const a = new Long(123, 456);
      const b = new Long(123, 456);
      expect(a.comp(b)).toBe(0);
    });

    it("returns -1 when this < other", () => {
      const a = new Long(100, 0);
      const b = new Long(200, 0);
      expect(a.comp(b)).toBe(-1);
    });

    it("returns 1 when this > other", () => {
      const a = new Long(200, 0);
      const b = new Long(100, 0);
      expect(a.comp(b)).toBe(1);
    });

    it("compares high parts first", () => {
      const a = new Long(999, 1);
      const b = new Long(100, 2);
      expect(a.comp(b)).toBe(-1); // High part 1 < 2
    });

    it("compares low parts when high equal", () => {
      const a = new Long(100, 5);
      const b = new Long(200, 5);
      expect(a.comp(b)).toBe(-1);
    });
  });

  describe("lessThanOrEqual", () => {
    it("returns true when this < other", () => {
      const a = new Long(100, 0);
      const b = new Long(200, 0);
      expect(a.lessThanOrEqual(b)).toBe(true);
    });

    it("returns true when this == other", () => {
      const a = new Long(100, 5);
      const b = new Long(100, 5);
      expect(a.lessThanOrEqual(b)).toBe(true);
    });

    it("returns false when this > other", () => {
      const a = new Long(200, 0);
      const b = new Long(100, 0);
      expect(a.lessThanOrEqual(b)).toBe(false);
    });
  });

  describe("fromValue", () => {
    it("converts number via fromNumber", () => {
      const long = Long.fromValue(12345);
      expect(long.low).toBe(12345);
      expect(long.high).toBe(0);
    });

    it("converts object with low/high", () => {
      const long = Long.fromValue({ low: 123, high: 456 });
      expect(long.low).toBe(123);
      expect(long.high).toBe(456);
    });

    it("converts existing Long", () => {
      const original = new Long(123, 456);
      const copy = Long.fromValue(original);
      expect(copy.low).toBe(123);
      expect(copy.high).toBe(456);
    });
  });

  describe("integration: round-trip conversions", () => {
    it("fromNumber -> toString -> fromNumber", () => {
      const values = [0, 1, 12345, 0x100000000];

      values.forEach((val) => {
        const long = Long.fromNumber(val);
        const str = long.toString();
        const num = parseInt(str, 10);
        expect(num).toBe(val);
      });
    });

    it("fromBytesLE -> toBytesLE round-trip", () => {
      const testBytes = [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
        [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0],
      ];

      testBytes.forEach((bytes) => {
        const long = Long.fromBytesLE(bytes);
        const result = long.toBytesLE();
        expect(result).toEqual(bytes);
      });
    });
  });
});
