// This is blue #9 from https://www.radix-ui.com/docs/colors/palette-composition/the-scales

import { FunctionFailure } from "./sync/function_result";

// It must look good in both light and dark mode.
const INFO_COLOR = "color:rgb(0, 145, 255)";

export type UdfType = "query" | "mutation" | "action" | "any";

function prefix_for_source(source: UdfType) {
  switch (source) {
    case "query":
      return "Q";
    case "mutation":
      return "M";
    case "action":
      return "A";
    case "any":
      return "?";
  }
}

export function logToConsole(
  type: "info" | "error",
  source: UdfType,
  udfPath: string,
  message: string
) {
  const prefix = prefix_for_source(source);

  if (type === "info") {
    const match = message.match(/^\[.*?\] /);
    if (match === null) {
      console.error(
        `[CONVEX ${prefix}(${udfPath})] Could not parse console.log`
      );
      return;
    }
    const level = message.slice(1, match[0].length - 2);
    const args = message.slice(match[0].length);

    console.log(
      `%c[CONVEX ${prefix}(${udfPath})] [${level}]`,
      INFO_COLOR,
      args
    );
  } else {
    console.error(`[CONVEX ${prefix}(${udfPath})] ${message}`);
  }
}

export function logFatalError(message: string): Error {
  const errorMessage = `[CONVEX FATAL ERROR] ${message}`;
  console.error(errorMessage);
  return new Error(errorMessage);
}

export function createHybridErrorStacktrace(
  source: UdfType,
  udfPath: string,
  request: FunctionFailure
): string {
  const prefix = prefix_for_source(source);
  return `[CONVEX ${prefix}(${udfPath})] ${request.errorMessage}\n  Called by client`;
}
