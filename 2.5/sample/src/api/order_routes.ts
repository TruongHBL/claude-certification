// API: nhận yêu cầu đặt đơn từ app.
import { submitLegacyOrder, formatCurrency } from "../utils/index.ts";

export function handleSubmit(req: { orderId: string; amount: number }): { ok: boolean; message: string } {
  const result = submitLegacyOrder(req.orderId);
  return { ok: result.status === "processed", message: `Đã nhận đơn ${req.orderId} (${formatCurrency(req.amount)})` };
}
