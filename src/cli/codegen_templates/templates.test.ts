import { test } from "@jest/globals";
import { tsconfigCodegen } from "./tsconfig.js";
import { readmeCodegen } from "./readme.js";

import prettier from "prettier";

test("templates parse", () => {
  prettier.format(tsconfigCodegen(), {
    parser: "json",
  });
  prettier.format(readmeCodegen(), { parser: "markdown" });
});
