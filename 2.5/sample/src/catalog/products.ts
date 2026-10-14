// Danh mục sản phẩm giả lập.
export const PRODUCTS = [
  { sku: "A", name: "Áo thun", price: 120000 },
  { sku: "B", name: "Quần jean", price: 450000 },
];

export function findProduct(sku: string) {
  return PRODUCTS.find((p) => p.sku === sku);
}
