import { test } from "@jest/globals";
import { ApiFromModules } from "../api/index.js";
import { assert, Equals } from "../test/type_testing.js";
import {
  actionGeneric,
  mutationGeneric,
  queryGeneric,
} from "./impl/registration_impl.js";
import {
  NamedSchedulableFunction,
  SchedulableFunctionNames,
} from "./scheduler.js";

const myModule = {
  query: queryGeneric(_ => false),
  action: actionGeneric(_ => "result"),
  mutation: mutationGeneric(_ => 123),
};

type API = ApiFromModules<{
  myModule: typeof myModule;
}>;

test("SchedulableFunctionNames", () => {
  type Expected = "myModule:action" | "myModule:mutation";
  type Actual = SchedulableFunctionNames<API>;
  assert<Equals<Expected, Actual>>();
});

test("NamedSchedulableFunction finds actions", () => {
  type Expected = () => string;
  type Actual = NamedSchedulableFunction<API, "myModule:action">;
  assert<Equals<Expected, Actual>>();
});

test("NamedSchedulableFunction finds mutations", () => {
  type Expected = () => number;
  type Actual = NamedSchedulableFunction<API, "myModule:mutation">;
  assert<Equals<Expected, Actual>>();
});
