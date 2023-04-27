import { convexToJson, Value } from "../../values/index.js";
import { version } from "../../index.js";
import { performAsyncSyscall } from "./syscall.js";
import { parseArgs } from "../../common/index.js";

export function setupMutationScheduler() {
  return {
    runAfter: async (
      delayMs: number,
      name: string,
      args?: Record<string, Value>
    ) => {
      const syscallArgs = runAfterSyscallArgs(delayMs, name, args);
      return await performAsyncSyscall("schedule", syscallArgs);
    },
    runAt: async (
      ms_since_epoch_or_date: number | Date,
      name: string,
      args?: Record<string, Value>
    ) => {
      const syscallArgs = runAtSyscallArgs(ms_since_epoch_or_date, name, args);
      return await performAsyncSyscall("schedule", syscallArgs);
    },
  };
}

export function setupActionScheduler(requestId: string) {
  return {
    runAfter: async (
      delayMs: number,
      name: string,
      args?: Record<string, Value>
    ) => {
      const syscallArgs = {
        requestId,
        ...runAfterSyscallArgs(delayMs, name, args),
      };
      return await performAsyncSyscall("actions/schedule", syscallArgs);
    },
    runAt: async (
      ms_since_epoch_or_date: number | Date,
      name: string,
      args?: Record<string, Value>
    ) => {
      const syscallArgs = {
        requestId,
        ...runAtSyscallArgs(ms_since_epoch_or_date, name, args),
      };
      return await performAsyncSyscall("actions/schedule", syscallArgs);
    },
  };
}

function runAfterSyscallArgs(
  delayMs: number,
  name: string,
  args?: Record<string, Value>
) {
  if (typeof delayMs !== "number") {
    throw new Error("`delayMs` must be a number");
  }
  if (!isFinite(delayMs)) {
    throw new Error("`delayMs` must be a finite number");
  }
  if (delayMs < 0) {
    throw new Error("`delayMs` must be non-negative");
  }
  const functionArgs = parseArgs(args);
  // Note the syscall expects a unix timestamp, measured in seconds.
  const ts = (Date.now() + delayMs) / 1000.0;
  return {
    name,
    ts,
    args: [convexToJson(functionArgs)],
    version,
  };
}

function runAtSyscallArgs(
  ms_since_epoch_or_date: number | Date,
  name: string,
  args?: Record<string, Value>
) {
  let ts;
  if (ms_since_epoch_or_date instanceof Date) {
    ts = ms_since_epoch_or_date.valueOf() / 1000.0;
  } else if (typeof ms_since_epoch_or_date === "number") {
    // The timestamp the developer passes is in milliseconds, while the syscall
    // accepts seconds since the epoch.
    ts = ms_since_epoch_or_date / 1000;
  } else {
    throw new Error("The invoke time must a Date or a timestamp");
  }
  const functionArgs = parseArgs(args);
  return {
    name,
    ts,
    args: [convexToJson(functionArgs)],
    version,
  };
}
