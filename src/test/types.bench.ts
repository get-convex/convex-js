import { bench } from "@ark/attest";
import type {
  ApiFromModules,
  FunctionReferencesInModule,
} from "../server/api.js";

import type * as admin from "./fake_chef/admin.js";
import type * as apiKeys from "./fake_chef/apiKeys.js";
import type * as cleanup from "./fake_chef/cleanup.js";
import type * as compressMessages from "./fake_chef/compressMessages.js";
import type * as convexProjects from "./fake_chef/convexProjects.js";
import type * as crons from "./fake_chef/crons.js";
import type * as debugPrompt from "./fake_chef/debugPrompt.js";
import type * as deploy from "./fake_chef/deploy.js";
import type * as dev from "./fake_chef/dev.js";
import type * as http from "./fake_chef/http.js";
import type * as lz4 from "./fake_chef/lz4.js";
import type * as lz4Wasm from "./fake_chef/lz4Wasm.js";
import type * as messages from "./fake_chef/messages.js";
import type * as openaiProxy from "./fake_chef/openaiProxy.js";
import type * as rateLimiter from "./fake_chef/rateLimiter.js";
import type * as resendProxy from "./fake_chef/resendProxy.js";
import type * as sessions from "./fake_chef/sessions.js";
import type * as share from "./fake_chef/share.js";
import type * as snapshot from "./fake_chef/snapshot.js";
import type * as socialShare from "./fake_chef/socialShare.js";

export type Modules = {
  admin: typeof admin;
  apiKeys: typeof apiKeys;
  cleanup: typeof cleanup;
  compressMessages: typeof compressMessages;
  convexProjects: typeof convexProjects;
  crons: typeof crons;
  debugPrompt: typeof debugPrompt;
  deploy: typeof deploy;
  dev: typeof dev;
  http: typeof http;
  lz4: typeof lz4;
  lz4Wasm: typeof lz4Wasm;
  messages: typeof messages;
  openaiProxy: typeof openaiProxy;
  rateLimiter: typeof rateLimiter;
  resendProxy: typeof resendProxy;
  sessions: typeof sessions;
  share: typeof share;
  snapshot: typeof snapshot;
  socialShare: typeof socialShare;
};

// exclude overhead of loading first module to isolate
// scaling performance as number of modules increases
bench.baseline(() => {
  type TransformModules<T> = {
    [K in keyof T]: { [K1 in keyof T[K]]: T[K][K1] }[keyof T[K]];
  }[keyof T];

  type Value = TransformModules<Modules>;
  return {} as ApiFromModules<{ admin: typeof admin }> | Value;
});

bench("Flat ApiFromModules", () => {
  type Actual = ApiFromModules<Modules>;

  return {} as Actual;
  // original 24168
}).types([24168, "instantiations"]);

export type SegmentedModules = {
  "a/b/c": typeof admin;
  "a/b/d": typeof apiKeys;
  "b/c/d": typeof admin;
  c: typeof cleanup;
  // omitted
  "b/c/e": typeof compressMessages;
  d: typeof compressMessages;
};

type Expected = {
  a: {
    b: {
      c: FunctionReferencesInModule<typeof admin>;
      d: FunctionReferencesInModule<typeof apiKeys>;
    };
  };
  b: {
    c: {
      d: FunctionReferencesInModule<typeof admin>;
    };
  };
  c: FunctionReferencesInModule<typeof cleanup>;
};

type Equals<A, B> = [A, B] extends [B, A] ? true : false;

bench("Segmented ApiFromModules", () => {
  type Actual = ApiFromModules<SegmentedModules>;
  const _equal: true = {} as Equals<Actual, Expected>;
  return {} as Actual;
}).types([1796, "instantiations"]);
