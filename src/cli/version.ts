import { version as versionInner } from "../index.js";

export const version = process.env.CONVEX_VERSION_OVERRIDE || versionInner;
