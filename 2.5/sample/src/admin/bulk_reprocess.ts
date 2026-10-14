// Admin: xử lý lại hàng loạt đơn (lượt chính và lượt thử lại).
import { processLegacyOrder } from "../orders/legacy.ts";
import type { OrderResult } from "../orders/types.ts";

export function bulkReprocess(primaryIds: string[], retryIds: string[]): OrderResult[] {
  const results: OrderResult[] = [];
  for (const id of primaryIds) {
    results.push(processLegacyOrder(id));
  }
  for (const id of retryIds) {
    results.push(processLegacyOrder(id));
  }
  return results;
}
