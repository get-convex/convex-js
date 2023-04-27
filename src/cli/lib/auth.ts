export function validateIdentityProviderURL(iss: string) {
  iss = iss.trim();
  if (!/^https?:\/\//i.test(iss)) {
    iss = "https://" + iss;
  }
  const issURL = new URL(iss);
  if (issURL.protocol !== "https:") {
    throw new Error("Only https identity providers are supported");
  }
  return issURL;
}
