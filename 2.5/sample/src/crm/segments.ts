// Phân nhóm khách theo hạng thành viên.
import { findCustomer } from "./customer.ts";

export function segmentOf(customerId: string): "vip" | "regular" {
  return findCustomer(customerId).tier === "gold" ? "vip" : "regular";
}
