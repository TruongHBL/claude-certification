// Bài 1.5 – bản CLI: MCP server stdio (TypeScript, dùng lib/mcp_server.ts) với đúng 6 tool như bản SDK (server "ops").
// 3 tool dữ liệu cố tình trả 3 định dạng ngày/status khác nhau để hook PostToolUse chuẩn hoá.
// Tool tiền tệ ghi vào LEDGER_FILE: đây là bằng chứng tool THẬT SỰ đã chạy (bị hook chặn thì không có dòng nào).
import { appendFileSync } from "node:fs";
import { runServer, textResult, type ToolDef } from "../../lib/mcp_server.ts";

const LEDGER_FILE = process.env.LEDGER_FILE;
const ledger = (line: string) => LEDGER_FILE && appendFileSync(LEDGER_FILE, line + "\n");

const ORDER_ID = { type: "object", properties: { order_id: { type: "string", description: "Mã đơn hàng, ví dụ ORD-1001" } }, required: ["order_id"] };
const money = (idField: string) => ({
  type: "object",
  properties: { [idField]: { type: "string" }, amount_usd: { type: "number", exclusiveMinimum: 0 } },
  required: [idField, "amount_usd"],
});

const TOOLS: ToolDef[] = [
  { name: "get_order", description: "Lấy thông tin đơn hàng (ngày tạo, trạng thái đơn).", inputSchema: ORDER_ID },
  { name: "get_shipment", description: "Lấy trạng thái vận chuyển của đơn hàng.", inputSchema: ORDER_ID },
  { name: "get_payment", description: "Lấy trạng thái thanh toán của đơn hàng.", inputSchema: ORDER_ID },
  { name: "process_refund", description: "Hoàn tiền cho đơn hàng.", inputSchema: money("order_id") },
  { name: "aml_check", description: "Kiểm tra chống rửa tiền (AML) cho khách hàng.",
    inputSchema: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"] } },
  { name: "transfer_funds", description: "Chuyển tiền cho khách hàng.", inputSchema: money("customer_id") },
];

runServer({
  name: "ops",
  tools: TOOLS,
  handlers: {
    get_order: (a) => textResult({ order_id: a.order_id, created_ts: 1_790_845_200, status_code: 2 }), // Unix giây + mã số
    get_shipment: (a) => textResult({ tracking_no: `SHP-${a.order_id}`, shipped_at: "2026-10-03T09:30:00+09:00", state: "IN_TRANSIT" }), // ISO + HOA_GẠCH
    get_payment: (a) => textResult({ payment_id: `PAY-${a.order_id}`, paid_on: "02/10/2026", st: "P" }), // DD/MM/YYYY + 1 ký tự
    process_refund: (a) => {
      ledger(`refund ${a.order_id} $${a.amount_usd}`);
      return textResult({ order_id: a.order_id, refunded_usd: a.amount_usd, result: "ok" });
    },
    aml_check: (a) => textResult({ customer_id: a.customer_id, aml: String(a.customer_id ?? "").startsWith("BLOCKED") ? "fail" : "pass" }),
    transfer_funds: (a) => {
      ledger(`transfer ${a.customer_id} $${a.amount_usd}`);
      return textResult({ customer_id: a.customer_id, transferred_usd: a.amount_usd, result: "ok" });
    },
  },
});
