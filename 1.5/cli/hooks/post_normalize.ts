// PostToolUse(mcp__ops__get_*): chuẩn hoá 3 định dạng về 1 schema {source, id, date ISO-8601 UTC, status} TRƯỚC khi Claude thấy.
// updatedToolOutput: thay output cho mọi tool (Claude Code 2.1.296 có trong schema hook output);
// updatedMCPToolOutput là trường cũ chỉ cho MCP tool.
import { hookInput, readPayload, shortName, writePayload } from "./lib.ts";

const ORDER_STATUS: Record<number, string> = { 1: "pending", 2: "shipped", 3: "delivered", 4: "cancelled" };
const PAYMENT_STATUS: Record<string, string> = { P: "paid", N: "pending", F: "failed", R: "refunded" };

function toIso(v: unknown): string {
  if (typeof v === "number") return new Date(v * 1000).toISOString();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v));
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))).toISOString();
  return new Date(String(v)).toISOString();
}

type Normalizer = (r: Record<string, any>) => Record<string, unknown>;
const NORMALIZERS: Record<string, Normalizer> = {
  get_order: (r) => ({ source: "order", id: r.order_id, date: toIso(r.created_ts), status: ORDER_STATUS[r.status_code] ?? `unknown (${r.status_code})` }),
  get_shipment: (r) => ({ source: "shipment", id: r.tracking_no, date: toIso(r.shipped_at), status: String(r.state ?? "").toLowerCase().replaceAll("_", " ") }),
  get_payment: (r) => ({ source: "payment", id: r.payment_id, date: toIso(r.paid_on), status: PAYMENT_STATUS[r.st] ?? `unknown (${r.st})` }),
};

const inp = hookInput();
const norm = NORMALIZERS[shortName(inp.tool_name)];
const raw = readPayload(inp.tool_response);
if (norm && raw) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: writePayload(inp.tool_response, norm(raw)) } }) + "\n",
  );
}
