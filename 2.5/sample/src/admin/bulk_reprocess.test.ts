import assert from "node:assert/strict";
import { test } from "../../test_harness.ts";
import { bulkReprocess } from "./bulk_reprocess.ts";

test("bulkReprocess xử lý cả lượt chính và lượt thử lại", () => {
  const r = bulkReprocess(["ORD-2001", "ORD-2002"], ["ORD-2003"]);
  assert.equal(r.length, 3);
  assert.ok(r.every((x) => x.status === "processed"));
});
