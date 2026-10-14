import assert from "node:assert/strict";
import { test } from "../../test_harness.ts";
import { handleSubmit } from "./order_routes.ts";

test("handleSubmit trả ok khi đơn được xử lý", () => {
  const r = handleSubmit({ orderId: "ORD-3001", amount: 99000 });
  assert.equal(r.ok, true);
  assert.match(r.message, /ORD-3001/);
});
