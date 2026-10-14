// Tìm sản phẩm theo tên (không phân biệt hoa thường).
import { PRODUCTS } from "./products.ts";

export function searchProducts(q: string) {
  const k = q.toLowerCase();
  return PRODUCTS.filter((p) => p.name.toLowerCase().includes(k));
}
