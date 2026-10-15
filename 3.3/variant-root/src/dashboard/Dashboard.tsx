// Bảng điều khiển: đếm số dự án matching theo trạng thái.
export type Status = "open" | "matched" | "closed";

export function countByStatus(statuses: Status[]): Record<Status, number> {
  const out: Record<Status, number> = { open: 0, matched: 0, closed: 0 };
  for (const s of statuses) out[s]++;
  return out;
}
