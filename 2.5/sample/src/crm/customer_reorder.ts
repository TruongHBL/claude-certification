// CRM: khách đặt lại đơn cũ từ lịch sử mua hàng.
import { processLegacyOrder } from "../orders/legacy.ts";
import { findCustomer } from "./customer.ts";

export function reorder(customerId: string, previousOrderId: string): string {
  const customer = findCustomer(customerId);
  const result = processLegacyOrder(previousOrderId);
  return `${customer.name}: ${result.status}`;
}
