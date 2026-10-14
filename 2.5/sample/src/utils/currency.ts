// Định dạng tiền VND.
export function formatCurrency(amount: number): string {
  return `${amount.toLocaleString("vi-VN")} ₫`;
}
