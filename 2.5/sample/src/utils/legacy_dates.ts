// Định dạng ngày kiểu cũ (dd/mm/yyyy) cho báo cáo xuất Excel. Không liên quan tới xử lý đơn.
export function toLegacyDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
