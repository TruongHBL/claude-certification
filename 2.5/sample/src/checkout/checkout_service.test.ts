import assert from "node:assert/strict";
import { test } from "../../test_harness.ts";
import { checkoutCart } from "./checkout_service.ts";

// Test này đi qua module nguồn, không nhắc tên hàm xử lý đơn.
test("checkoutCart tính tổng và xử lý đơn", () => {
  const r = checkoutCart({ orderId: "ORD-1001", items: [{ sku: "A", price: 120000, qty: 2 }] });
  assert.equal(r.status, "processed");
  assert.equal(r.total, "240.000 ₫");
});
