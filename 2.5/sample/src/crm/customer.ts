// Dữ liệu khách hàng giả lập.
const CUSTOMERS: Record<string, { name: string; tier: string }> = {
  "CUS-0042": { name: "Nguyễn Thị Lan", tier: "gold" },
  "CUS-0117": { name: "Trần Văn Minh", tier: "silver" },
};

export function findCustomer(id: string): { name: string; tier: string } {
  return CUSTOMERS[id] ?? { name: "(khách lạ)", tier: "none" };
}
