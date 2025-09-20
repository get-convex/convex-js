import { expect, test, afterEach, vi } from "vitest";
import { oneoffContext } from "./context.js";
import { TestFilesystem } from "./test_helpers.js";
import * as fs from "fs";

// Although these tests are run as ESM by ts-lint, this file is built as both
// CJS and ESM by TypeScript so normal recipes like `__dirname` for getting the
// script directory don't work.
const dirname = "src/bundler";

import {
  bundle,
  doesImportConvexHttpRouter,
  entryPoints,
  entryPointsByEnvironment,
  useNodeDirectiveRegex,
  mustBeIsolate,
  loadConvexIgnore,
} from "./index.js";

const sorted = <T>(arr: T[], key: (el: T) => any): T[] => {
  const newArr = [...arr];
  const cmp = (a: T, b: T) => {
    if (key(a) < key(b)) return -1;
    if (key(a) > key(b)) return 1;
    return 0;
  };
  return newArr.sort(cmp);
};

const getDefaultCtx = async () => {
  return await oneoffContext({
    url: undefined,
    adminKey: undefined,
    envFile: undefined,
  });
};

afterEach(() => {
  vi.resetAllMocks();
});

test("bundle function is present", () => {
  expect(typeof bundle).toEqual("function");
});

test("bundle finds JavaScript functions", async () => {
  const fixtureDir = dirname + "/test_fixtures/js/project01";
  const ctx = await getDefaultCtx();
  const entryPoints = await entryPointsByEnvironment(ctx, fixtureDir);
  const bundles = sorted(
    (await bundle(ctx, fixtureDir, entryPoints.isolate, false, "browser"))
      .modules,
    (b) => b.path,
  ).filter((bundle) => !bundle.path.includes("_deps"));
  expect(bundles).toHaveLength(2);
  expect(bundles[0].path).toEqual("bar.js");
  expect(bundles[1].path).toEqual("foo.js");
});

test("returns true when simple import httpRouter found", async () => {
  const result = await doesImportConvexHttpRouter(`
    import { httpRouter } from "convex/server";

    export const val = 1;
    `);
  expect(result).toBeTruthy();
});

test("returns false when httpRouter is not imported", async () => {
  const result = await doesImportConvexHttpRouter(`
    export const val = 1;
    `);
  expect(result).toBeFalsy();
});

test("returns true when multiline import httpRouter found", async () => {
  const result = await doesImportConvexHttpRouter(`
    import {
      httpRouter
    } from "convex/server";

    export const val = 1;
    `);
  expect(result).toBeTruthy();
});

test("returns true when httpRouter is imported with alias", async () => {
  const result = await doesImportConvexHttpRouter(`
    import { httpRouter as router } from "convex/server";

    export const val = 1;
    `);
  expect(result).toBeTruthy();
});

test("returns true when httpRouter is imported with alias and multiline", async () => {
  const result = await doesImportConvexHttpRouter(`
    import {
      httpRouter as router
    } from "convex/server";

    export const val = 1;
    `);
  expect(result).toBeTruthy();
});

test("returns true when multiple imports and httpRouter is imported", async () => {
  const result = await doesImportConvexHttpRouter(`
    import { cronJobs, httpRouter } from "convex/server";

    export const val = 1;
    `);
  expect(result).toBeTruthy();
});

test("bundle warns about https.js|ts at top level", async () => {
  const fixtureDir = dirname + "/test_fixtures/js/project_with_https";
  const logSpy = vi.spyOn(process.stderr, "write");
  await entryPoints(await getDefaultCtx(), fixtureDir);
  expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("https"));
});

test("bundle does not warn about https.js|ts which is not at top level", async () => {
  const fixtureDir =
    dirname + "/test_fixtures/js/project_with_https_not_at_top_level";
  const logSpy = vi.spyOn(process.stderr, "write");
  await entryPoints(await getDefaultCtx(), fixtureDir);
  expect(logSpy).toHaveBeenCalledTimes(0);
});

test("bundle does not warn about https.js|ts which does not import httpRouter", async () => {
  const fixtureDir =
    dirname + "/test_fixtures/js/project_with_https_without_router";
  const logSpy = vi.spyOn(process.stderr, "write");
  await entryPoints(await getDefaultCtx(), fixtureDir);
  expect(logSpy).toHaveBeenCalledTimes(0);
});

test("use node regex", () => {
  // Double quotes
  expect('"use node";').toMatch(useNodeDirectiveRegex);
  // Single quotes
  expect("'use node';").toMatch(useNodeDirectiveRegex);
  // No semi column
  expect('"use node"').toMatch(useNodeDirectiveRegex);
  expect("'use node'").toMatch(useNodeDirectiveRegex);
  // Extra spaces
  expect('   "use node"   ').toMatch(useNodeDirectiveRegex);
  expect("   'use node'   ").toMatch(useNodeDirectiveRegex);

  // Nothing
  expect("").not.toMatch(useNodeDirectiveRegex);
  // No quotes
  expect("use node").not.toMatch(useNodeDirectiveRegex);
  // In a comment
  expect('// "use node";').not.toMatch(useNodeDirectiveRegex);
  // Typo
  expect('"use nod";').not.toMatch(useNodeDirectiveRegex);
  // Extra quotes
  expect('""use node"";').not.toMatch(useNodeDirectiveRegex);
  expect("''use node'';").not.toMatch(useNodeDirectiveRegex);
  // Extra semi colons
  expect('"use node";;;').not.toMatch(useNodeDirectiveRegex);
  // Twice
  expect('"use node";"use node";').not.toMatch(useNodeDirectiveRegex);
});

test("must use isolate", () => {
  expect(mustBeIsolate("http.js")).toBeTruthy();
  expect(mustBeIsolate("http.mjs")).toBeTruthy();
  expect(mustBeIsolate("http.ts")).toBeTruthy();
  expect(mustBeIsolate("crons.js")).toBeTruthy();
  expect(mustBeIsolate("crons.cjs")).toBeTruthy();
  expect(mustBeIsolate("crons.ts")).toBeTruthy();
  expect(mustBeIsolate("schema.js")).toBeTruthy();
  expect(mustBeIsolate("schema.jsx")).toBeTruthy();
  expect(mustBeIsolate("schema.ts")).toBeTruthy();
  expect(mustBeIsolate("schema.js")).toBeTruthy();

  expect(mustBeIsolate("http.sample.js")).not.toBeTruthy();
  expect(mustBeIsolate("https.js")).not.toBeTruthy();
  expect(mustBeIsolate("schema2.js")).not.toBeTruthy();
  expect(mustBeIsolate("schema/http.js")).not.toBeTruthy();
});

test("loadConvexIgnore loads patterns from .convexignore file", async () => {
  const ctx = await getDefaultCtx();

  const fixtureContent = fs.readFileSync(
    dirname + "/test_fixtures/convexignore/basic/.convexignore",
    "utf8"
  );

  const testFs = new TestFilesystem({
    ".convexignore": fixtureContent
  });

  const mockCtx = { ...ctx, fs: testFs };
  const ig = loadConvexIgnore(mockCtx, "/");

  // Test that the patterns are loaded correctly
  expect(ig.ignores("file.test.ts")).toBeTruthy();
  expect(ig.ignores("component.spec.js")).toBeTruthy();
  expect(ig.ignores("tmp/file.ts")).toBeTruthy();
  expect(ig.ignores("data.tmp")).toBeTruthy();
  expect(ig.ignores("ignored-file.ts")).toBeTruthy();

  // Test that non-ignored files are not ignored
  expect(ig.ignores("regular-file.ts")).toBeFalsy();
  expect(ig.ignores("src/index.ts")).toBeFalsy();
});

test("loadConvexIgnore checks multiple locations for .convexignore", async () => {
  const ctx = await getDefaultCtx();

  // Only the convex/.convexignore exists
  const testFs = new TestFilesystem({
    "test": {
      "project": {
        "convex": {
          ".convexignore": "*.ignored"
        }
      }
    }
  });

  const mockCtx = { ...ctx, fs: testFs };
  const ig = loadConvexIgnore(mockCtx, "/test/project");

  // Should load from convex/.convexignore when root .convexignore doesn't exist
  expect(ig.ignores("file.ignored")).toBeTruthy();
  expect(ig.ignores("file.ts")).toBeFalsy();
});

test("entryPoints respects .convexignore patterns", async () => {
  const ctx = await getDefaultCtx();

  const testFs = new TestFilesystem({
    "test": {
      "convex": {
        ".convexignore": "ignored.ts\n*.test.ts",
        "normal.ts": 'export const foo = "bar";',
        "ignored.ts": 'export const ignored = true;',
        "file.test.ts": 'export const test = true;',
      }
    }
  });

  const mockCtx = { ...ctx, fs: testFs };
  const entries = await entryPoints(mockCtx, "/test/convex");

  // Should only include normal.ts, not the ignored files
  expect(entries).toHaveLength(1);
  expect(entries[0]).toContain("normal.ts");
  expect(entries[0]).not.toContain("ignored.ts");
  expect(entries[0]).not.toContain("file.test.ts");
});

test("loadConvexIgnore handles no .convexignore file gracefully", async () => {
  const ctx = await getDefaultCtx();

  const testFs = new TestFilesystem({
    "test": {
      "project": {
        "some-file.ts": "export default {};"
      }
    }
  });

  const mockCtx = { ...ctx, fs: testFs };
  const ig = loadConvexIgnore(mockCtx, "/test/project");

  // Should not throw and should return an ignore instance that ignores nothing
  expect(ig.ignores("any-file.ts")).toBeFalsy();
});

test("bundle respects .convexignore with multiple convex files", async () => {
  const ctx = await getDefaultCtx();

  const fixtureContent = fs.readFileSync(
    dirname + "/test_fixtures/convexignore/multiple_files/.convexignore",
    "utf8"
  );

  const testFs = new TestFilesystem({
    "test": {
      "convex": {
        ".convexignore": fixtureContent,
        "api.ts": 'export default "api content";',
        "_private.ts": 'export default "private content";',
        "_utils.ts": 'export default "utils content";',
        "old-api.ts": 'export default "old api content";',
        "mutations.ts": 'export default "mutations content";',
        "queries.ts": 'export default "queries content";',
      }
    }
  });

  const mockCtx = { ...ctx, fs: testFs };
  const entries = await entryPoints(mockCtx, "/test/convex");

  // Should include only non-ignored files
  expect(entries.map(e => e.split('/').pop())).toEqual(
    expect.arrayContaining(["api.ts", "mutations.ts", "queries.ts"])
  );
  expect(entries).not.toContain(expect.stringContaining("_private.ts"));
  expect(entries).not.toContain(expect.stringContaining("_utils.ts"));
  expect(entries).not.toContain(expect.stringContaining("old-api.ts"));
});

test(".convexignore handles complex patterns and edge cases", async () => {
  const ctx = await getDefaultCtx();

  const fixtureContent = fs.readFileSync(
    dirname + "/test_fixtures/convexignore/complex_patterns/.convexignore",
    "utf8"
  );

  const testFs = new TestFilesystem({
    ".convexignore": fixtureContent
  });

  const mockCtx = { ...ctx, fs: testFs };
  const ig = loadConvexIgnore(mockCtx, "/");

  // Test glob patterns
  expect(ig.ignores("deep/nested/file.test.ts")).toBeTruthy();
  expect(ig.ignores("test/helper.ts")).toBeTruthy();
  expect(ig.ignores("src/test/utils.ts")).toBeTruthy();
  expect(ig.ignores("node_modules/package/index.js")).toBeTruthy();

  // Test negation
  expect(ig.ignores("important.test.ts")).toBeFalsy();

  // Test directories
  expect(ig.ignores("build/output.js")).toBeTruthy();
  expect(ig.ignores("dist/bundle.js")).toBeTruthy();
  expect(ig.ignores(".next/static/chunk.js")).toBeTruthy();

  // Test extensions
  expect(ig.ignores("debug.log")).toBeTruthy();
  expect(ig.ignores("file.tmp")).toBeTruthy();
  expect(ig.ignores("backup.bak")).toBeTruthy();

  // Test hidden files
  expect(ig.ignores(".gitignore")).toBeTruthy();
  expect(ig.ignores(".env")).toBeTruthy();
  expect(ig.ignores(".env.local")).toBeFalsy(); // negated
});

test(".convexignore with invalid patterns doesn't break bundling", async () => {
  const ctx = await getDefaultCtx();

  const testFs = new TestFilesystem({
    ".convexignore": `# Some valid patterns
*.test.ts

# These patterns are actually valid in gitignore format
# Square brackets and parentheses are literal characters unless properly escaped
[invalid
(unclosed

# More valid patterns
tmp/`
  });

  const mockCtx = { ...ctx, fs: testFs };
  const ig = loadConvexIgnore(mockCtx, "/");

  // Valid patterns should still work
  expect(ig.ignores("file.test.ts")).toBeTruthy();
  expect(ig.ignores("tmp/file.js")).toBeTruthy();

  // These patterns behave differently - parentheses match literally, brackets don't
  expect(ig.ignores("[invalid")).toBeFalsy();
  expect(ig.ignores("(unclosed")).toBeTruthy();

  // Non-matching files should not be ignored
  expect(ig.ignores("valid-file.ts")).toBeFalsy();
});

test(".convexignore respects gitignore semantics", async () => {
  const ctx = await getDefaultCtx();

  const fixtureContent = fs.readFileSync(
    dirname + "/test_fixtures/convexignore/gitignore_semantics/.convexignore",
    "utf8"
  );

  const testFs = new TestFilesystem({
    ".convexignore": fixtureContent
  });

  const mockCtx = { ...ctx, fs: testFs };
  const ig = loadConvexIgnore(mockCtx, "/");

  // Root-only patterns
  expect(ig.ignores("root-only.ts")).toBeTruthy();
  expect(ig.ignores("subdir/root-only.ts")).toBeFalsy();

  // Directory patterns
  expect(ig.ignores("logs/error.log")).toBeTruthy();
  expect(ig.ignores("logs")).toBeFalsy(); // directories need trailing slash

  // Double asterisk patterns
  expect(ig.ignores("generated/code.ts")).toBeTruthy();
  expect(ig.ignores("src/generated/api.ts")).toBeTruthy();
  expect(ig.ignores("deep/nested/generated/file.ts")).toBeTruthy();

  // Wildcard patterns
  expect(ig.ignores("api.test.ts")).toBeTruthy();
  expect(ig.ignores("utils.test.js")).toBeTruthy();

  // Single character wildcard
  expect(ig.ignores("file1.ts")).toBeTruthy();
  expect(ig.ignores("fileA.ts")).toBeTruthy();
  expect(ig.ignores("file10.ts")).toBeFalsy(); // two characters
});
