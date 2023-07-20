/**
 * @jest-environment jsdom
 */

import { RequestForQueries, useQueriesHelper } from "./use_queries";
import { test, expect, jest } from "@jest/globals";
import FakeWatch from "../test/fake_watch";
import { act, renderHook } from "@testing-library/react";
import { anyApi } from "../server/api.js";

test("Adding a new query", () => {
  const createWatch = jest.fn(() => new FakeWatch<any>()) as any;

  // Request 1 query.
  let queries: RequestForQueries = {
    query1: {
      query: anyApi.query1.default,
      args: {},
    },
  };
  const { result, rerender } = renderHook(() =>
    useQueriesHelper(queries, createWatch)
  );

  // Initially the query is loading (undefined).
  expect(result.current).toStrictEqual({
    query1: undefined,
  });
  expect(createWatch.mock.calls.length).toBe(1);

  // When the query loads, we get the result.
  act(() => {
    createWatch.mock.results[0].value.setValue("query1 result");
  });
  expect(result.current).toStrictEqual({
    query1: "query1 result",
  });

  // Add a second query, it's initially loading.
  queries = {
    query1: {
      query: anyApi.query1.default,
      args: {},
    },
    query2: {
      query: anyApi.query2.default,
      args: {},
    },
  };
  rerender();
  expect(result.current).toStrictEqual({
    query1: "query1 result",
    query2: undefined,
  });
  expect(createWatch.mock.calls.length).toBe(2);

  // When the query resolves, we also get the result.
  act(() => {
    createWatch.mock.results[1].value.setValue("query2 result");
  });
  expect(result.current).toStrictEqual({
    query1: "query1 result",
    query2: "query2 result",
  });
});

test("Swapping queries and unsubscribing", () => {
  const createWatch = jest.fn(() => new FakeWatch<any>()) as any;

  // Request 1 query.
  let queries: RequestForQueries = {
    query: {
      query: anyApi.query1.default,
      args: {},
    },
  };
  const { rerender, unmount } = renderHook(() =>
    useQueriesHelper(queries, createWatch)
  );

  // One watch was created and we're listening to it.
  expect(createWatch.mock.calls.length).toBe(1);
  expect(createWatch.mock.results[0].value.numCallbacks()).toBe(1);

  // Switch to a different query.
  queries = {
    query1: {
      query: anyApi.query2.default,
      args: {},
    },
  };
  rerender();

  // Now 2 different watches have been created and we're only listening to the second.
  expect(createWatch.mock.calls.length).toBe(2);
  expect(createWatch.mock.results[0].value.numCallbacks()).toBe(0);
  expect(createWatch.mock.results[1].value.numCallbacks()).toBe(1);

  // After unmount, we've unsubscribed to all the queries.
  unmount();
  expect(createWatch.mock.calls.length).toBe(2);
  expect(createWatch.mock.results[0].value.numCallbacks()).toBe(0);
  expect(createWatch.mock.results[1].value.numCallbacks()).toBe(0);
});
