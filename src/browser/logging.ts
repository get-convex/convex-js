// This is blue #9 from https://www.radix-ui.com/docs/colors/palette-composition/the-scales
// It must look good in both light and dark mode.
const INFO_COLOR = "color:rgb(0, 145, 255)";

export type UdfType = "query" | "mutation" | "action";

function prefix_for_source(source: UdfType) {
  switch (source) {
    case "query":
      return "Q";
    case "mutation":
      return "M";
    case "action":
      return "A";
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
    console.log(`%c[CONVEX ${prefix}(${udfPath})] ${message}`, INFO_COLOR);
  } else {
    console.error(`[CONVEX ${prefix}(${udfPath})] ${message}`);
  }
}

export function logFatalError(message: string): Error {
  const errorMessage = `[CONVEX FATAL ERROR] ${message}`;
  console.error(errorMessage);
  return new Error(errorMessage);
}

export function createError(
  source: UdfType,
  udfPath: string,
  message: string
): Error {
  const prefix = prefix_for_source(source);
  return new Error(`[CONVEX ${prefix}(${udfPath})] ${message}`);
}
