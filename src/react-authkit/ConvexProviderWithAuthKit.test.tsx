/**
 * @vitest-environment custom-vitest-environment.ts
 */
import { test } from "vitest";
import React from "react";
import { ConvexProviderWithAuthKit } from "./ConvexProviderWithAuthKit.js";
import { ConvexReactClient } from "../react/index.js";
import { useAuth } from "@workos-inc/authkit-react";

test("Helpers are valid children", () => {
  const convex = new ConvexReactClient("https://localhost:3001");

  const _ = (
    <ConvexProviderWithAuthKit client={convex} useAuth={useAuth}>
      Hello world
    </ConvexProviderWithAuthKit>
  );
});
