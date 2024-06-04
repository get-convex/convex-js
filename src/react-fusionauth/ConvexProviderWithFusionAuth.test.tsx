/**
 * @jest-environment jsdom
 */
import { test } from "@jest/globals";
import React from "react";
import { ConvexProviderWithFusionAuth } from "./ConvexProviderWithFusionAuth.js";
import { ConvexReactClient } from "../react/index.js";

test("Helpers are valid children", () => {
  const convex = new ConvexReactClient("https://localhost:3001");

  const _ = (
    <ConvexProviderWithFusionAuth client={convex}>
      Hello world
    </ConvexProviderWithFusionAuth>
  );
});
