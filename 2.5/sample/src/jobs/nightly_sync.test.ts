import assert from "node:assert/strict";
import { test } from "../../test_harness.ts";
import { nightlySync } from "./nightly_sync.ts";

test("nightlySync đếm số đơn đã xử lý", () => {
  assert.equal(nightlySync(["ORD-4001", "ORD-4002"]), 2);
});
