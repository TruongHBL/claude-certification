import assert from "node:assert/strict";
import { test } from "../../test_harness.ts";
import { processLegacyOrder } from "./legacy.ts";

// Test của chính hàm deprecated: giữ nguyên tới khi xoá hàm ở bản 3.0.
test("processLegacyOrder vẫn xử lý được đơn", () => {
  assert.equal(processLegacyOrder("ORD-0001").status, "processed");
});
