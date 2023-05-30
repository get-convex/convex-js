export function validateIdentityProviderURL(iss: string) {
  iss = iss.trim();
  if (!/^https?:\/\//i.test(iss)) {
    iss = "https://" + iss;
  }
  const issURL = new URL(iss);
  if (issURL.protocol !== "https:") {
    // Throwing here is okay because this code isn't called by `npx convex dev`
    // eslint-disable-next-line no-restricted-syntax
    throw new Error("Only https identity providers are supported");
  }
  return issURL;
}
