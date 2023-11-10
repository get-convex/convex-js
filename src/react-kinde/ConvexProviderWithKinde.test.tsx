/**
 * @jest-environment jsdom
 */
import { test } from "@jest/globals";
import React from "react";
import { ConvexProviderWithKinde } from "./ConvexProviderWithKinde.js";
import { ConvexReactClient } from "../react/index.js";

test("Helpers are valid children", () => {
  const convex = new ConvexReactClient("https://localhost:3001");

  const _ = (
    <ConvexProviderWithKinde client={convex}>
      Hello world
    </ConvexProviderWithKinde>
  );
});
