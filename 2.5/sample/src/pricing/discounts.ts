// Giảm giá theo hạng thành viên.
export function discountRate(tier: string): number {
  return tier === "gold" ? 0.1 : tier === "silver" ? 0.05 : 0;
}
