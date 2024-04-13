import { test, describe, expect } from "@jest/globals";
import { validateDeploymentUrl } from ".";

describe("validateDeploymentUrl", () => {
  test("localhost is valid", () => {
    validateDeploymentUrl("http://127.0.0.1:8000");
  });
  test("real URLs are valid", () => {
    validateDeploymentUrl("https://small-mouse-123.convex.cloud");
  });

  test("wrong protocol throws", () => {
    expect(() =>
      validateDeploymentUrl("ws://small-mouse-123.convex.cloud"),
    ).toThrow("Invalid deployment address");
  });
});
