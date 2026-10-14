// Xử lý đơn kiểu cũ: không kiểm tra mã đơn.
import type { OrderResult } from "./types.ts";

/**
 * @deprecated Dùng `processOrder(orderId, { validate: true })` trong `./process.ts`.
 * Sẽ bị xoá ở bản 3.0.
 */
export function processLegacyOrder(orderId: string): OrderResult {
  return { orderId, status: "processed", validated: false };
}
