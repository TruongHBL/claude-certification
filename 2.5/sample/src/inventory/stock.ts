// Tồn kho giả lập.
const STOCK: Record<string, number> = { A: 12, B: 0 };

export function inStock(sku: string): boolean {
  return (STOCK[sku] ?? 0) > 0;
}
