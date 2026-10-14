// Wrapper cũ: ghi nhật ký nguồn đơn rồi xử lý đơn. Nhiều job vẫn gọi qua đây.
import { processLegacyOrder } from "./legacy.ts";
import type { OrderResult } from "./types.ts";

export const applyLog: string[] = [];

export function applyLegacyOrder(order: { id: string; source: string }): OrderResult {
  applyLog.push(`${order.source} → ${order.id}`);
  return processLegacyOrder(order.id);
}
