// Bảng giá cũ trước năm 2025, chỉ còn dùng để đối soát. Không gọi xử lý đơn.
export const LEGACY_PRICE_TABLE: Record<string, number> = { A: 100000, B: 400000 };

export function legacyPrice(sku: string): number | undefined {
  return LEGACY_PRICE_TABLE[sku];
}
