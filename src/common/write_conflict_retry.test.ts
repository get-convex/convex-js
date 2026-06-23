import { describe, expect, test, vi } from "vitest";

import {
  isWriteConflictRetryableMessage,
  retryOnWriteConflict,
  validateMaxWriteConflictRetries,
  validateWriteConflictRetryDelayMs,
} from "./write_conflict_retry.js";

describe("write conflict retries", () => {
  test("matches Convex write conflict messages", () => {
    expect(
      isWriteConflictRetryableMessage("OptimisticConcurrencyControlFailure"),
    ).toBe(true);
    expect(
      isWriteConflictRetryableMessage(
        'Documents read from or written to the "users" table changed while this mutation was being run and on every subsequent retry.',
      ),
    ).toBe(true);
    expect(isWriteConflictRetryableMessage("Validation failed")).toBe(false);
  });

  test("validates retry counts", () => {
    expect(validateMaxWriteConflictRetries(undefined)).toBe(1);
    expect(
      validateMaxWriteConflictRetries({ maxWriteConflictRetries: 0 }),
    ).toBe(0);
    expect(
      validateMaxWriteConflictRetries({ maxWriteConflictRetries: 2 }),
    ).toBe(2);
    expect(() =>
      validateMaxWriteConflictRetries({ maxWriteConflictRetries: -1 }),
    ).toThrow("maxWriteConflictRetries must be a nonnegative integer.");
  });

  test("validates retry delays", () => {
    expect(validateWriteConflictRetryDelayMs(undefined)).toBe(2000);
    expect(
      validateWriteConflictRetryDelayMs({ writeConflictRetryDelayMs: 0 }),
    ).toBe(0);
    expect(
      validateWriteConflictRetryDelayMs({ writeConflictRetryDelayMs: 2500 }),
    ).toBe(2500);
    expect(() =>
      validateWriteConflictRetryDelayMs({ writeConflictRetryDelayMs: -1 }),
    ).toThrow("writeConflictRetryDelayMs must be a nonnegative number.");
  });

  test("retries write conflict errors", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const result = retryOnWriteConflict(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("OptimisticConcurrencyControlFailure");
        }
        return "ok";
      },
      {
        maxWriteConflictRetries: 1,
        writeConflictRetryDelayMs: 2000,
      },
    );

    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toBe("ok");
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  test("does not retry other errors", async () => {
    let calls = 0;
    await expect(
      retryOnWriteConflict(
        async () => {
          calls += 1;
          throw new Error("Validation failed");
        },
        {
          maxWriteConflictRetries: 1,
          writeConflictRetryDelayMs: 2000,
        },
      ),
    ).rejects.toThrow("Validation failed");
    expect(calls).toBe(1);
  });
});
