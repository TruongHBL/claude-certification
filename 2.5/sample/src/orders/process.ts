// API xử lý đơn mới (thay cho processLegacyOrder, xem docs/migration.md).
import type { OrderResult, ProcessOptions } from "./types.ts";

const ORDER_ID = /^ORD-\d{4}$/;

export function processOrder(orderId: string, opts: ProcessOptions): OrderResult {
  if (opts.validate && !ORDER_ID.test(orderId)) {
    throw new Error(`Mã đơn không hợp lệ: ${orderId}`);
  }
  return { orderId, status: "processed", validated: opts.validate };
}
