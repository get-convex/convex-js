/**
 * @jest-environment jsdom
 */
import { test } from "@jest/globals";
import React from "react";
import { ConvexProviderWithClerk } from "./ConvexProviderWithClerk";
import { ConvexReactClient } from "../react";
import { useAuth } from "@clerk/clerk-react";

test("Helpers are valid children", () => {
  const convex = new ConvexReactClient("https://localhost:3001");

  const _ = (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      Hello world
    </ConvexProviderWithClerk>
  );
});
