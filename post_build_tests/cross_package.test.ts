import { test } from "@jest/globals";
import { assert } from "../src/test/type_testing.js";
import { RegisteredQuery } from "../dist/types/server/index.js";
import { RegisteredQuery as RegisteredQueryInternal } from "../dist/internal-types/server/index.js";

describe("Types work even when combining what TypeScript believes are different packages", () => {
  test("RegisteredQuery extends StructuralRegisteredQuery across packages", () => {
    type RQAny = RegisteredQuery<"public", any, any>;
    // Within the same package, a RegisteredQuery extends RegisteredQuery
    assert<
      RegisteredQuery<"public", { a: number }, number> extends RQAny
        ? true
        : false
    >;

    // Across packages, a RegisteredQuery does not extend RegisteredQuery...
    assert<
      RegisteredQueryInternal<"public", { a: number }, number> extends RQAny
        ? false
        : true
    >;

    // Someday we can write a looser type that works across packages.
  });
});
