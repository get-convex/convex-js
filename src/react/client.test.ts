import { test, expect } from "@jest/globals";

import { ConvexReactClient, createMutation } from "./client.js";

const address = "https://127.0.0.1:3001";

test("ConvexReactClient can be constructed", () => {
  const client = new ConvexReactClient(address);
  expect(typeof client).not.toEqual("undefined");
});

test("Optimistic updates can be created", () => {
  const client = new ConvexReactClient(address);
  createMutation("myMutation", client).withOptimisticUpdate(() => {
    // no update
  });
});

test("Specifying an optimistic update twice produces an error", () => {
  const client = new ConvexReactClient(address);
  const mutation = createMutation("myMutation", client).withOptimisticUpdate(
    () => {
      // no update
    }
  );
  expect(() => {
    mutation.withOptimisticUpdate(() => {
      // no update
    });
  }).toThrow("Already specified optimistic update for mutation myMutation");
});

test("Using a mutation as an event handler directly throws a useful error", () => {
  const client = new ConvexReactClient(address);

  const fakeSyntheticEvent: any = {
    bubbles: false,
    cancelable: true,
    defaultPrevented: false,
    isTrusted: false,
    nativeEvent: {},
    preventDefault: () => undefined,
    isDefaultPrevented: false,
    stopPropagation: () => undefined,
    isPropagationStopped: false,
    persist: () => undefined,
    timeStamp: 0,
    type: "something",
  };
  const myMutation = createMutation("myMutation", client);
  expect(() => myMutation(fakeSyntheticEvent)).toThrow(
    "Convex function called with SyntheticEvent object."
  );
});
