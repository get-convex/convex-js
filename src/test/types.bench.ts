import { bench } from "@ark/attest";
import type {
  ApiFromModules,
  FunctionReferencesInModule,
} from "../server/api.js";
import type { Modules } from "./fake_chef/_generated/api.js";

type EvaluateModules<T> = {
  [K in keyof T]: { [K1 in keyof T[K]]: T[K][K1] }[keyof T[K]];
}[keyof T];

// exclude overhead of loading first module to isolate
// scaling performance as number of modules increases
bench.baseline(() => {
  type Value = EvaluateModules<Modules>;
  return {} as ApiFromModules<{ admin: Modules["admin"] }> | Value;
});

bench("Flat ApiFromModules", () => {
  type Actual = ApiFromModules<Modules>;

  return {} as EvaluateModules<Actual>;
  // was 27312
}).types([20041, "instantiations"]);

export type SegmentedModules = {
  "a/b/c": Modules["admin"];
  "a/b/d": Modules["apiKeys"];
  "b/c/d": Modules["sessions"];
  c: Modules["cleanup"];
  // omitted
  "b/c/e": Modules["compressMessages"];
  d: Modules["compressMessages"];
};

type Equals<A, B> = [A, B] extends [B, A] ? true : false;

bench("Segmented ApiFromModules", () => {
  type Actual = ApiFromModules<SegmentedModules>;

  type Expected = {
    a: {
      b: {
        c: FunctionReferencesInModule<Modules["admin"]>;
        d: FunctionReferencesInModule<Modules["apiKeys"]>;
      };
    };
    b: {
      c: {
        d: FunctionReferencesInModule<Modules["sessions"]>;
      };
    };
    c: FunctionReferencesInModule<Modules["cleanup"]>;
  };

  const _equal: true = {} as Equals<Actual, Expected>;
  return {} as EvaluateModules<Actual>;
  // was 7780
}).types([6681, "instantiations"]);
