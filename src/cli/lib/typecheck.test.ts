import { describe, expect, test } from "vitest";
import path from "path";
import { findTypeScriptCompilerPath } from "./typecheck.js";
import type { TypescriptCompiler } from "./typecheck.js";

const compilerPaths = {
  tsc: path.join("node_modules", "typescript", "bin", "tsc"),
  native: path.join("node_modules", "@typescript", "native", "bin", "tsc"),
  tsgo: path.join(
    "node_modules",
    "@typescript",
    "native-preview",
    "bin",
    "tsgo",
  ),
  legacyTsgo: path.join(
    "node_modules",
    "@typescript",
    "native-preview",
    "bin",
    "tsgo.js",
  ),
} as const;

describe("findTypeScriptCompilerPath", () => {
  test.each<{
    compiler: TypescriptCompiler;
    existing: string[];
    expected: string | undefined;
  }>([
    {
      compiler: "tsc",
      existing: [compilerPaths.tsc],
      expected: compilerPaths.tsc,
    },
    {
      compiler: "tsc",
      existing: [compilerPaths.native],
      expected: compilerPaths.native,
    },
    {
      compiler: "tsc",
      existing: [compilerPaths.tsc, compilerPaths.native],
      expected: compilerPaths.native,
    },
    {
      compiler: "tsgo",
      existing: [compilerPaths.tsgo],
      expected: compilerPaths.tsgo,
    },
    {
      compiler: "tsgo",
      existing: [compilerPaths.legacyTsgo],
      expected: compilerPaths.legacyTsgo,
    },
    {
      compiler: "tsgo",
      existing: [compilerPaths.tsgo, compilerPaths.legacyTsgo],
      expected: compilerPaths.tsgo,
    },
    { compiler: "tsc", existing: [], expected: undefined },
    { compiler: "tsgo", existing: [], expected: undefined },
  ])("finds $expected for $compiler", ({ compiler, existing, expected }) => {
    expect(
      findTypeScriptCompilerPath(
        { exists: (candidate) => existing.includes(candidate) },
        compiler,
      ),
    ).toBe(expected);
  });
});
