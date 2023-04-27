/**
 * @jest-environment jsdom
 */
/* eslint-disable @typescript-eslint/ban-types */
import { expect, jest, test } from "@jest/globals";
import { renderHook } from "@testing-library/react-hooks";
import React from "react";

import { PaginationOptions, PaginationResult } from "../server";
import { assert, Equals } from "../test/type_testing.js";
import { Value } from "../values";
import { ConvexProvider, ConvexReactClient } from "./client.js";
import {
  PaginatedQueryArgs,
  PaginatedQueryNames,
  PaginatedQueryReturnType,
  usePaginatedQueryGeneric,
} from "./use_paginated_query";

const address = "https://127.0.0.1:3001";

test.each([
  {
    options: undefined,
    expectedError:
      "Error: `options.initialNumItems` must be a positive number. Received `undefined`.",
  },
  {
    options: {},
    expectedError:
      "Error: `options.initialNumItems` must be a positive number. Received `undefined`.",
  },
  {
    options: { initialNumItems: -1 },
    expectedError:
      "Error: `options.initialNumItems` must be a positive number. Received `-1`.",
  },
  {
    options: { initialNumItems: "wrongType" },
    expectedError:
      "Error: `options.initialNumItems` must be a positive number. Received `wrongType`.",
  },
])("Throws an error when options is $options", ({ options, expectedError }) => {
  const convexClient = new ConvexReactClient(address);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConvexProvider client={convexClient}>{children}</ConvexProvider>
  );

  const { result } = renderHook(
    // @ts-expect-error We're testing user programming errors
    () => usePaginatedQueryGeneric("myQuery", {}, options),
    {
      wrapper,
    }
  );
  expect(result.error).not.toBeUndefined();
  expect(result.error!.toString()).toEqual(expectedError);
});

test("Initially returns LoadingMore", () => {
  const convexClient = new ConvexReactClient(address);
  const watchQuerySpy = jest.spyOn(convexClient, "watchQuery");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConvexProvider client={convexClient}>{children}</ConvexProvider>
  );

  const { result } = renderHook(
    () => usePaginatedQueryGeneric("myQuery", {}, { initialNumItems: 10 }),
    { wrapper }
  );

  expect(watchQuerySpy.mock.calls).toEqual([
    [
      "myQuery",
      {
        paginationOpts: {
          cursor: null,
          id: expect.anything(),
          numItems: 10,
        },
      },
      { journal: undefined },
    ],
  ]);
  expect(result.current).toStrictEqual({
    loadMore: undefined,
    results: [],
    status: "LoadingMore",
  });
});

test("Updates to a new query if query name or args change", () => {
  const convexClient = new ConvexReactClient(address);
  const watchQuerySpy = jest.spyOn(convexClient, "watchQuery");

  let args: [
    name: string,
    args: Record<string, Value>,
    options: { initialNumItems: number }
  ] = ["myQuery", {}, { initialNumItems: 10 }];
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConvexProvider client={convexClient}>{children}</ConvexProvider>
  );

  const { rerender } = renderHook(() => usePaginatedQueryGeneric(...args), {
    wrapper,
  });

  // Starts with just the initial query.
  expect(watchQuerySpy.mock.calls.length).toBe(1);
  expect(watchQuerySpy.mock.calls[0]).toEqual([
    "myQuery",
    {
      paginationOpts: {
        cursor: null,
        id: expect.anything(),
        numItems: 10,
      },
    },
    { journal: undefined },
  ]);

  // If we change the query name, we get a new call.
  args = ["myQuery2", {}, { initialNumItems: 10 }];
  rerender();
  expect(watchQuerySpy.mock.calls.length).toBe(2);
  expect(watchQuerySpy.mock.calls[1]).toEqual([
    "myQuery2",
    {
      paginationOpts: {
        cursor: null,
        id: expect.anything(),
        numItems: 10,
      },
    },
    { journal: undefined },
  ]);

  // If we add an arg, it also updates.
  args = ["myQuery2", { someArg: 123 }, { initialNumItems: 10 }];
  rerender();
  expect(watchQuerySpy.mock.calls.length).toBe(3);
  expect(watchQuerySpy.mock.calls[2]).toEqual([
    "myQuery2",
    {
      paginationOpts: { cursor: null, id: expect.anything(), numItems: 10 },
      someArg: 123,
    },
    { journal: undefined },
  ]);

  // Updating to a new arg object that serializes the same thing doesn't increase
  // the all count.
  args = ["myQuery2", { someArg: 123 }, { initialNumItems: 10 }];
  rerender();
  expect(watchQuerySpy.mock.calls.length).toBe(3);
});

describe("PaginatedQueryNames", () => {
  test("selects correct queries", () => {
    type Queries = {
      simplePaginated: (args: {
        paginationOpts: PaginationOptions;
      }) => PaginationResult<string>;
      paginatedWithArg: (args: {
        property: string;
        paginationOpts: PaginationOptions;
      }) => PaginationResult<string>;
      missingArg: () => PaginationResult<string>;
      emptyArg: () => PaginationResult<string>;
      wrongReturn: (args: { paginationOpts: PaginationOptions }) => string;
    };
    type API = {
      publicQueries: Queries;
      allQueries: Queries;
      publicMutations: {};
      allMutations: {};
      publicActions: {};
      allActions: {};
    };
    type Expected = "simplePaginated" | "paginatedWithArg";
    type Actual = PaginatedQueryNames<API>;
    assert<Equals<Actual, Expected>>();
  });
});

describe("PaginatedQueryArgs", () => {
  test("basic", () => {
    type MyQueryFunction = (args: {
      property: string;
      paginationOpts: PaginationOptions;
    }) => PaginationResult<string>;
    type Args = PaginatedQueryArgs<MyQueryFunction>;
    type ExpectedArgs = { property: string };
    assert<Equals<Args, ExpectedArgs>>();
  });

  test("interface args", () => {
    interface Arg {
      property: string;
      paginationOpts: PaginationOptions;
    }
    type MyQueryFunction = (args: Arg) => PaginationResult<string>;
    type Args = PaginatedQueryArgs<MyQueryFunction>;
    type ExpectedArgs = {
      property: string;
    };
    assert<Equals<Args, ExpectedArgs>>();
  });
});

describe("PaginatedQueryReturnType", () => {
  test("interface return type", () => {
    interface ReturnType {
      property: string;
    }
    type MyQueryFunction = (
      opts: PaginationOptions
    ) => PaginationResult<ReturnType>;
    type ActualReturnType = PaginatedQueryReturnType<MyQueryFunction>;
    assert<Equals<ActualReturnType, ReturnType>>();
  });
});
