// Thanh toán giỏ hàng: tính tổng rồi xử lý đơn.
import { processLegacyOrder } from "../orders/legacy.ts";
import { formatCurrency } from "../utils/currency.ts";

export interface Cart {
  orderId: string;
  items: { sku: string; price: number; qty: number }[];
}

export function checkoutCart(cart: Cart): { total: string; status: string } {
  const total = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const result = processLegacyOrder(cart.orderId);
  return { total: formatCurrency(total), status: result.status };
}
