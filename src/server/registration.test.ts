import { test } from "@jest/globals";
import { assert, Equals } from "../test/type_testing.js";
import { v } from "../values/validator.js";
import { FunctionArgs, MutationBuilder } from "./registration.js";

describe("argument inference", () => {
  // Test with mutation, but all the wrappers work the same way.
  const mutation: MutationBuilder<any, any, "public"> = (() => {
    // Intentional noop. We're only testing the type
  }) as any;

  test("inline with no arg", () => {
    const func = mutation(() => "result");
    type Args = (typeof func)["args"];
    type ExpectedArgs = [];
    assert<Equals<Args, ExpectedArgs>>;
  });

  test("inline with untyped arg", () => {
    const func = mutation((_, { arg }) => {
      assert<Equals<typeof arg, unknown>>;
      return "result";
    });
    type Args = (typeof func)["args"];
    type ExpectedArgs = [FunctionArgs];
    assert<Equals<Args, ExpectedArgs>>;
  });

  test("inline with typed arg", () => {
    const func = mutation((_, { arg }: { arg: string }) => {
      assert<Equals<typeof arg, string>>;
      return "result";
    });
    type Args = (typeof func)["args"];
    type ExpectedArgs = [{ arg: string }];
    assert<Equals<Args, ExpectedArgs>>;
  });

  test("config with no arg", () => {
    const func = mutation({
      handler: () => "result",
    });
    type Args = (typeof func)["args"];
    type ExpectedArgs = [];
    assert<Equals<Args, ExpectedArgs>>;
  });

  test("config with no arg and validator", () => {
    const func = mutation({
      args: {},
      handler: () => "result",
    });
    type Args = (typeof func)["args"];
    // It would be cool if this could infer the args as `[]`, but this is okay
    // too.
    // eslint-disable-next-line @typescript-eslint/ban-types
    type ExpectedArgs = [{}];
    assert<Equals<Args, ExpectedArgs>>;
  });

  test("config with untyped arg", () => {
    const func = mutation({
      handler: (_, { arg }) => {
        assert<Equals<typeof arg, unknown>>;
        return "result";
      },
    });
    type Args = (typeof func)["args"];
    type ExpectedArgs = [FunctionArgs];
    assert<Equals<Args, ExpectedArgs>>;
  });

  test("config with typed arg", () => {
    const func = mutation({
      handler: (_, { arg }: { arg: string }) => {
        assert<Equals<typeof arg, string>>;
        return "result";
      },
    });
    type Args = (typeof func)["args"];
    type ExpectedArgs = [{ arg: string }];
    assert<Equals<Args, ExpectedArgs>>;
  });

  test("config with untyped arg and validator", () => {
    const func = mutation({
      args: {
        arg: v.string(),
      },
      handler: (_, { arg }) => {
        assert<Equals<typeof arg, string>>;
        return "result";
      },
    });
    type Args = (typeof func)["args"];
    type ExpectedArgs = [{ arg: string }];
    assert<Equals<Args, ExpectedArgs>>;
  });

  test("config with untyped arg and optional validator", () => {
    const func = mutation({
      args: {
        arg: v.optional(v.string()),
      },
      handler: (_, { arg }) => {
        assert<Equals<typeof arg, string | undefined>>;
        return "result";
      },
    });
    type Args = (typeof func)["args"];
    type ExpectedArgs = [{ arg?: string }];
    assert<Equals<Args, ExpectedArgs>>;
  });

  test("config with typed arg and validator", () => {
    const func = mutation({
      args: {
        arg: v.string(),
      },
      handler: (_, { arg }: { arg: string }) => {
        assert<Equals<typeof arg, string>>;
        return "result";
      },
    });
    type Args = (typeof func)["args"];
    type ExpectedArgs = [{ arg: string }];
    assert<Equals<Args, ExpectedArgs>>;
  });

  test("config with mismatched typed arg and validator", () => {
    // @ts-expect-error  The arg type mismatches
    mutation({
      args: {
        _arg: v.number(),
      },
      handler: (_, { _arg }: { _arg: string }) => {
        return "result";
      },
    });
  });
});
