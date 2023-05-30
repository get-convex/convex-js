import { test, describe, expect } from "@jest/globals";
import { validateDeploymentUrl } from ".";

describe("validateDeploymentUrl", () => {
  test("localhost is valid", () => {
    validateDeploymentUrl("http://127.0.0.1:8000");
  });
  test("real URLs are valid", () => {
    validateDeploymentUrl("https://small-mouse-123.convex.cloud");
  });

  test("missing .cloud throws", () => {
    expect(() =>
      validateDeploymentUrl("https://small-mouse-123.convex")
    ).toThrowError("Invalid deployment address");
  });

  test("wrong protocol throws", () => {
    expect(() =>
      validateDeploymentUrl("ws://small-mouse-123.convex.cloud")
    ).toThrowError("Invalid deployment address");
  });
});
