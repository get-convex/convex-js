/**
 * @jest-environment jsdom
 */
import { test } from "@jest/globals";
import React from "react";
import { ConvexProviderWithAuth0 } from "./ConvexProviderWithAuth0";
import { ConvexReactClient } from "../react";

test("Helpers are valid children", () => {
  const convex = new ConvexReactClient("https://localhost:3001");

  const _ = (
    <ConvexProviderWithAuth0 client={convex}>
      Hello world
    </ConvexProviderWithAuth0>
  );
});
