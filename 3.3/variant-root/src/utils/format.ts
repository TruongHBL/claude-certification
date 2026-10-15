// Định dạng tiền và ngày cho màn hình CRM. File trung lập: không khớp rule nào.
export function formatYen(amount: number): string {
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
