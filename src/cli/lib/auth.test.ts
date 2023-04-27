import { test, expect } from "@jest/globals";
import { validateIdentityProviderURL } from "./auth.js";

test("validateIdentityProviderURL", () => {
  expect(validateIdentityProviderURL("domain.us.auth0.com").href).toEqual(
    "https://domain.us.auth0.com/"
  );
  expect(validateIdentityProviderURL("   domain.us.auth0.com   ").href).toEqual(
    "https://domain.us.auth0.com/"
  );
  expect(
    validateIdentityProviderURL("https://domain.us.auth0.com").href
  ).toEqual("https://domain.us.auth0.com/");
  expect(() =>
    validateIdentityProviderURL("http://domain.us.auth0.com")
  ).toThrow("Only https identity providers are supported");
});
