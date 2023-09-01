import { ConvexHttpClient, setFetch } from "./http_client.js";

// In Node.js <18 fetch may need to be provided.
setFetch(
  globalThis.fetch ||
    ((...args) =>
      import("node-fetch").then(({ default: fetch }) =>
        (fetch as unknown as typeof globalThis.fetch)(...args)
      ))
);

export { ConvexHttpClient };
