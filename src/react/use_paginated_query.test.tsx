/**
 * @jest-environment jsdom
 */
/* eslint-disable @typescript-eslint/ban-types */
import { expect, jest, test } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import React from "react";

import {
  FunctionReference,
  makeFunctionReference,
  PaginationOptions,
  PaginationResult,
} from "../server";
import { assert, Equals } from "../test/type_testing.js";
import { Value } from "../values";
import { ConvexProvider, ConvexReactClient } from "./client.js";
import { PaginatedQueryArgs, usePaginatedQuery } from "./use_paginated_query";
import { PaginatedQueryItem } from "./use_paginated_query";

const address = "https://127.0.0.1:3001";

type Props = { onError: (e: Error) => void; children: any };
class ErrorBoundary extends React.Component<Props> {
  state: { error: Error | undefined } = { error: undefined };
  onError: (e: Error) => void;

  constructor(props: Props) {
    super(props);
    this.onError = props.onError;
  }

  componentDidCatch(error: Error) {
    this.onError(error);
    return { error };
  }

  render() {
    if (this.state.error) {
      return this.state.error.toString();
    }

    return this.props.children;
  }
}

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
  let lastError: Error | undefined = undefined;
  function updateError(e: Error) {
    lastError = e;
  }

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ErrorBoundary onError={updateError}>
      <ConvexProvider client={convexClient}>{children}</ConvexProvider>
    </ErrorBoundary>
  );

  renderHook(
    () =>
      // @ts-expect-error We're testing user programming errors
      usePaginatedQuery(makeFunctionReference<"query">("myQuery"), {}, options),
    {
      wrapper,
    }
  );
  expect(lastError).not.toBeUndefined();
  expect(lastError!.toString()).toEqual(expectedError);
});

test("Initially returns LoadingFirstPage", () => {
  const convexClient = new ConvexReactClient(address);
  const watchQuerySpy = jest.spyOn(convexClient, "watchQuery");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConvexProvider client={convexClient}>{children}</ConvexProvider>
  );

  const { result } = renderHook(
    () =>
      usePaginatedQuery(
        makeFunctionReference<"query">("myQuery"),
        {},
        { initialNumItems: 10 }
      ),
    { wrapper }
  );

  expect(watchQuerySpy.mock.calls).toEqual([
    [
      makeFunctionReference("myQuery"),
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
  expect(result.current).toMatchObject({
    isLoading: true,
    results: [],
    status: "LoadingFirstPage",
  });
});

test("Updates to a new query if query name or args change", () => {
  const convexClient = new ConvexReactClient(address);
  const watchQuerySpy = jest.spyOn(convexClient, "watchQuery");

  let args: [
    query: FunctionReference<"query">,
    args: Record<string, Value>,
    options: { initialNumItems: number }
  ] = [makeFunctionReference("myQuery"), {}, { initialNumItems: 10 }];
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConvexProvider client={convexClient}>{children}</ConvexProvider>
  );

  const { rerender } = renderHook(() => usePaginatedQuery(...args), {
    wrapper,
  });

  // Starts with just the initial query.
  expect(watchQuerySpy.mock.calls.length).toBe(1);
  expect(watchQuerySpy.mock.calls[0]).toEqual([
    makeFunctionReference("myQuery"),
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
  args = [
    makeFunctionReference<"query">("myQuery2"),
    {},
    { initialNumItems: 10 },
  ];
  rerender();
  expect(watchQuerySpy.mock.calls.length).toBe(2);
  expect(watchQuerySpy.mock.calls[1]).toEqual([
    makeFunctionReference("myQuery2"),
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
  args = [
    makeFunctionReference("myQuery2"),
    { someArg: 123 },
    { initialNumItems: 10 },
  ];
  rerender();
  expect(watchQuerySpy.mock.calls.length).toBe(3);
  expect(watchQuerySpy.mock.calls[2]).toEqual([
    makeFunctionReference("myQuery2"),
    {
      paginationOpts: { cursor: null, id: expect.anything(), numItems: 10 },
      someArg: 123,
    },
    { journal: undefined },
  ]);

  // Updating to a new arg object that serializes the same thing doesn't increase
  // the all count.
  args = [
    makeFunctionReference("myQuery2"),
    { someArg: 123 },
    { initialNumItems: 10 },
  ];
  rerender();
  expect(watchQuerySpy.mock.calls.length).toBe(3);
});

describe("PaginatedQueryArgs", () => {
  test("basic", () => {
    type MyQueryFunction = FunctionReference<
      "query",
      "public",
      { paginationOpts: PaginationOptions; property: string },
      PaginationResult<string>
    >;
    type Args = PaginatedQueryArgs<MyQueryFunction>;
    type ExpectedArgs = { property: string };
    assert<Equals<Args, ExpectedArgs>>();
  });
});

describe("PaginatedQueryItem", () => {
  test("interface return type", () => {
    interface ReturnType {
      property: string;
    }
    type MyQueryFunction = FunctionReference<
      "query",
      "public",
      { paginationOpts: PaginationOptions; property: string },
      PaginationResult<ReturnType>
    >;
    type ActualReturnType = PaginatedQueryItem<MyQueryFunction>;
    assert<Equals<ActualReturnType, ReturnType>>();
  });
});
