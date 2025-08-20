import { bench } from "@ark/attest";
import type { api } from "./fake_chef/_generated/api.js";

bench("ApiFromModules", () => {
  return {} as typeof api;
}).types([115837, "instantiations"]);
