import { describe, test, expect } from "vitest";
import { compareModulePaths } from "./common.js";

describe("compareModulePaths", () => {
  test("matches default sort order for forward slash paths", () => {
    const paths = ["fooBaz.ts", "foo/bar.ts", "foo.ts"];
    expect([...paths].sort(compareModulePaths)).toEqual([...paths].sort());
  });

  test("orders Windows paths identically to their POSIX equivalents", () => {
    const posixPaths = ["fooBaz.ts", "foo/bar.ts", "foo.ts"];
    const windowsPaths = posixPaths.map((p) => p.replace(/\//g, "\\"));

    const sortedPosix = [...posixPaths].sort(compareModulePaths);
    const sortedWindows = [...windowsPaths].sort(compareModulePaths);

    expect(sortedPosix).toEqual(["foo.ts", "foo/bar.ts", "fooBaz.ts"]);
    expect(sortedWindows.map((p) => p.replace(/\\/g, "/"))).toEqual(
      sortedPosix,
    );
  });

  test("default sort diverges on this input, demonstrating the bug", () => {
    // "/" (0x2F) sorts before letters while "\" (0x5C) sorts after them,
    // so the OS-native forms of the same file set sort differently.
    const windowsPaths = ["fooBaz.ts", "foo\\bar.ts", "foo.ts"];
    expect([...windowsPaths].sort()).toEqual([
      "foo.ts",
      "fooBaz.ts",
      "foo\\bar.ts",
    ]);
    expect([...windowsPaths].sort(compareModulePaths)).toEqual([
      "foo.ts",
      "foo\\bar.ts",
      "fooBaz.ts",
    ]);
  });

  test("sorts nested directories before longer sibling file names", () => {
    const paths = ["a/b/c.ts", "aZ.ts", "a.ts", "a/b.ts"];
    expect([...paths].sort(compareModulePaths)).toEqual([
      "a.ts",
      "a/b.ts",
      "a/b/c.ts",
      "aZ.ts",
    ]);
    const windows = paths.map((p) => p.replace(/\//g, "\\"));
    expect(
      [...windows].sort(compareModulePaths).map((p) => p.replace(/\\/g, "/")),
    ).toEqual(["a.ts", "a/b.ts", "a/b/c.ts", "aZ.ts"]);
  });
});
