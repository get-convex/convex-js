/* eslint-disable @typescript-eslint/ban-types */
import { assert, Equals } from "../test/type_testing.js";
import { describe, test } from "@jest/globals";
import {
  actionGeneric,
  mutationGeneric,
  queryGeneric,
  internalQueryGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  FunctionArgs,
} from "../server";
import {
  ApiFromModules,
  ArgsAndOptions,
  ArgsObject,
  OptionalRestArgs,
} from "./index.js";

describe("ApiFromModules", () => {
  test("finds queries and mutations", () => {
    const myModule = {
      query: queryGeneric((_, _args: { arg: number }) => "query result"),
      mutation: mutationGeneric(_ => "query result"),
    };

    type API = ApiFromModules<{
      myModule: typeof myModule;
    }>;
    type ExpectedAPI = {
      allQueries: {
        "myModule:query": (args: { arg: number }) => string;
      };
      publicQueries: {
        "myModule:query": (args: { arg: number }) => string;
      };
      allMutations: {
        "myModule:mutation": () => string;
      };
      publicMutations: {
        "myModule:mutation": () => string;
      };
      allActions: {};
      publicActions: {};
    };
    assert<Equals<API, ExpectedAPI>>;
  });

  test("finds actions", () => {
    const myModule = {
      importantQuestion: actionGeneric((_, _args: { arg: number }) => 42),
    };

    type API = ApiFromModules<{
      myModule: typeof myModule;
    }>;
    type ExpectedAPI = {
      allQueries: {};
      publicQueries: {};
      allMutations: {};
      publicMutations: {};
      allActions: {
        "myModule:importantQuestion": (args: { arg: number }) => number;
      };
      publicActions: {
        "myModule:importantQuestion": (args: { arg: number }) => number;
      };
    };
    assert<Equals<API, ExpectedAPI>>;
  });

  test("correctly names default exports", () => {
    const myModule = {
      default: queryGeneric(_ => "query result"),
    };

    type API = ApiFromModules<{
      myModule: typeof myModule;
    }>;

    type ExpectedAPI = {
      allQueries: {
        myModule: () => string;
      };
      publicQueries: {
        myModule: () => string;
      };
      allMutations: {};
      publicMutations: {};
      allActions: {};
      publicActions: {};
    };
    assert<Equals<API, ExpectedAPI>>;
  });

  test("ignores exports that aren't queries or mutations", () => {
    const myModule = {
      number: 123,
      function: () => "return value",
      object: { property: "value" },
    };

    type API = ApiFromModules<{
      myModule: typeof myModule;
    }>;
    // None of these exports are queries or mutations.
    type ExpectedAPI = {
      allQueries: {};
      publicQueries: {};
      allMutations: {};
      publicMutations: {};
      allActions: {};
      publicActions: {};
    };
    assert<Equals<API, ExpectedAPI>>;
  });

  test("applies return type conversions", () => {
    const myModule = {
      returnsPromise: queryGeneric(() => Promise.resolve("query result")),
      returnsUndefined: queryGeneric(() => undefined),
      returnsVoid: queryGeneric(() => {
        // Intentionally empty
      }),
      returnsVoidPromise: queryGeneric(() => Promise.resolve()),
    };

    type API = ApiFromModules<{
      myModule: typeof myModule;
    }>;
    type ExpectedAPI = {
      allQueries: {
        // The promise isn't present in the return type.
        "myModule:returnsPromise": () => string;
        // `undefined` is converted to `null`.
        "myModule:returnsUndefined": () => null;
        // `void` is converted to `null`.
        "myModule:returnsVoid": () => null;
        // We should apply both transforms together.
        "myModule:returnsVoidPromise": () => null;
      };
      publicQueries: {
        // The promise isn't present in the return type.
        "myModule:returnsPromise": () => string;
        // `undefined` is converted to `null`.
        "myModule:returnsUndefined": () => null;
        // `void` is converted to `null`.
        "myModule:returnsVoid": () => null;
        // We should apply both transforms together.
        "myModule:returnsVoidPromise": () => null;
      };
      allMutations: {};
      publicMutations: {};
      allActions: {};
      publicActions: {};
    };
    assert<Equals<API, ExpectedAPI>>;
  });

  test("separates internal functions", () => {
    const myModule = {
      query: queryGeneric((_, _args: { arg: number }) => "query result"),
      internalQuery: internalQueryGeneric(
        (_, _args: { arg: number }) => "query result"
      ),
      mutation: mutationGeneric(_ => "query result"),
      internalMutation: internalMutationGeneric(_ => "query result"),
    };

    const myActionsModule = {
      action: actionGeneric((_, _args: { arg: number }) => 42),
      internalAction: internalActionGeneric((_, _args: { arg: number }) => 42),
    };

    type API = ApiFromModules<{
      myModule: typeof myModule;
      "actions/myActionsModule": typeof myActionsModule;
    }>;
    type ExpectedAPI = {
      allQueries: {
        "myModule:query": (args: { arg: number }) => string;
        "myModule:internalQuery": (args: { arg: number }) => string;
      };
      publicQueries: {
        "myModule:query": (args: { arg: number }) => string;
      };
      allMutations: {
        "myModule:mutation": () => string;
        "myModule:internalMutation": () => string;
      };
      publicMutations: {
        "myModule:mutation": () => string;
      };
      allActions: {
        "actions/myActionsModule:action": (args: { arg: number }) => number;
        "actions/myActionsModule:internalAction": (args: {
          arg: number;
        }) => number;
      };
      publicActions: {
        "actions/myActionsModule:action": (args: { arg: number }) => number;
      };
    };
    assert<Equals<API, ExpectedAPI>>;
  });

  test("correctly infers arguments", () => {
    const myModule = {
      noArg: queryGeneric(_ => "query result"),
      oneTypedArg: queryGeneric((_, _args: { arg: number }) => "query result"),
      onUnTypedArg: queryGeneric((_, _args) => "query result"),
    };

    type API = ApiFromModules<{
      myModule: typeof myModule;
    }>;
    type ExpectedAPI = {
      allQueries: {
        "myModule:noArg": () => string;
        "myModule:oneTypedArg": (args: { arg: number }) => string;
        "myModule:onUnTypedArg": (args: FunctionArgs) => string;
      };
      publicQueries: {
        "myModule:noArg": () => string;
        "myModule:oneTypedArg": (args: { arg: number }) => string;
        "myModule:onUnTypedArg": (args: FunctionArgs) => string;
      };
      allMutations: {};
      publicMutations: {};
      allActions: {};
      publicActions: {};
    };
    assert<Equals<API, ExpectedAPI>>;
  });
});

describe("ArgsObject", () => {
  test("infers Record<string, never> for functions with no args", () => {
    type MyFunction = () => {};
    type ExpectedArgs = Record<string, never>;
    type Args = ArgsObject<MyFunction>;
    assert<Equals<Args, ExpectedArgs>>();
  });

  test("infers args for functions with args", () => {
    type MyFunction = (args: { property: string }) => {};
    type ExpectedArgs = { property: string };
    type Args = ArgsObject<MyFunction>;
    assert<Equals<Args, ExpectedArgs>>();
  });
});

describe("OptionalRestArgs", () => {
  test("infers rest type with optional args for functions with no args", () => {
    type MyFunction = () => {};
    type ExpectedArgs = [Record<string, never>?];
    type Args = OptionalRestArgs<MyFunction>;
    assert<Equals<Args, ExpectedArgs>>();
  });

  test("infers rest type with required args for functions with args", () => {
    type MyFunction = (args: { property: string }) => {};
    type ExpectedArgs = [{ property: string }];
    type Args = OptionalRestArgs<MyFunction>;
    assert<Equals<Args, ExpectedArgs>>();
  });
});

describe("ArgsAndOptions", () => {
  type Options = {
    option1?: string;
    option2: number;
  };

  test("infers rest type with optional args and optional options for functions with no args", () => {
    type MyFunction = () => {};
    type ExpectedArgs = [Record<string, never>?, Options?];
    type Args = ArgsAndOptions<MyFunction, Options>;
    assert<Equals<Args, ExpectedArgs>>();
  });

  test("infers rest type with required args and optional options for functions with args", () => {
    type MyFunction = (args: { property: string }) => {};
    type ExpectedArgs = [{ property: string }, Options?];
    type Args = ArgsAndOptions<MyFunction, Options>;
    assert<Equals<Args, ExpectedArgs>>();
  });
});
