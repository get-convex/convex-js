/**
 * @jest-environment jsdom
 */
import { test, expect } from "@jest/globals";

import { ConvexReactClient, createMutation, useQuery } from "./client.js";
import { ConvexProvider } from "./index.js";
import React from "react";
import { renderHook } from "@testing-library/react-hooks";
import { anyApi } from "../server/api.js";

const address = "https://127.0.0.1:3001";

describe("ConvexReactClient", () => {
  test("can be constructed", () => {
    const client = new ConvexReactClient(address);
    expect(typeof client).not.toEqual("undefined");
  });
});
describe("createMutation", () => {
  test("Optimistic updates can be created", () => {
    const client = new ConvexReactClient(address);
    createMutation(anyApi.myMutation.default, client).withOptimisticUpdate(
      () => {
        // no update
      }
    );
  });

  test("Specifying an optimistic update twice produces an error", () => {
    const client = new ConvexReactClient(address);
    const mutation = createMutation(
      anyApi.myMutation.default,
      client
    ).withOptimisticUpdate(() => {
      // no update
    });
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
    const myMutation = createMutation(anyApi.myMutation.default, client);
    expect(() => myMutation(fakeSyntheticEvent)).toThrow(
      "Convex function called with SyntheticEvent object."
    );
  });
});

describe("useQueryGeneric", () => {
  function createClientWithQuery() {
    const client = new ConvexReactClient(address);
    // Use an optimistic update to set up a query to have a result.
    void client.mutation(
      anyApi.myMutation.default,
      {},
      {
        optimisticUpdate: localStore => {
          localStore.setQuery(anyApi.myQuery.default, {}, "queryResult");
        },
      }
    );
    return client;
  }

  test("returns the result", () => {
    const client = createClientWithQuery();
    const wrapper = ({ children }: any) => (
      <ConvexProvider client={client}>{children}</ConvexProvider>
    );
    const { result } = renderHook(() => useQuery(anyApi.myQuery.default), {
      wrapper,
    });
    expect(result.current).toStrictEqual("queryResult");
  });
});

describe("async query fetch", () => {
  const client = new ConvexReactClient(address);

  function optimisticUpdate() {
    // Use an optimistic update to set up a query to have a result.
    void client.mutation(
      anyApi.myMutation.default,
      {},
      {
        optimisticUpdate: localStore => {
          localStore.setQuery(anyApi.myQuery.default, {}, "queryResult");
        },
      }
    );
  }

  test("returns after optimistic update", async () => {
    const queryResult = client.query(anyApi.myQuery.default, {});
    optimisticUpdate();
    expect(await queryResult).toStrictEqual("queryResult");
  });

  test("returns existing result", async () => {
    optimisticUpdate();
    const queryResult = client.query(anyApi.myQuery.default, {});
    expect(await queryResult).toStrictEqual("queryResult");
  });
});
