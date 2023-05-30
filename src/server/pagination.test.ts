import { assert } from "../test/type_testing.js";
import { test } from "@jest/globals";
import { PaginationOptions, paginationOptsValidator } from "./pagination.js";
import { Infer } from "../values/validator.js";

test("paginationOptsValidator matches the paginationOpts type", () => {
  type validatorType = Infer<typeof paginationOptsValidator>;
  assert<validatorType extends PaginationOptions ? true : false>();
});
