// Tiện ích ngày tháng.
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
