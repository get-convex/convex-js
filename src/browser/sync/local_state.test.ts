import { test } from "@jest/globals";

import { LocalSyncState } from "./local_state.js";

test("can create a local state", () => {
  new LocalSyncState();
});
