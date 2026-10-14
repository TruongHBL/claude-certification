import assert from "node:assert/strict";
import { test } from "../../test_harness.ts";
import { reorder } from "./customer_reorder.ts";

test("reorder trả trạng thái kèm tên khách", () => {
  assert.equal(reorder("CUS-0042", "ORD-5001"), "Nguyễn Thị Lan: processed");
});
