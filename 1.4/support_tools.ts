// Bài 1.4 – phần dùng chung cho bản API (bai_1_4_prerequisite_gate.ts) và bản CLI (support_mcp_server.ts):
// 4 tool, dữ liệu giả, PREREQUISITE GATE và validator handoff 5 trường.
//
// Cổng chặn nằm trong CODE của handler process_refund, không nằm trong prompt:
//   chưa có get_customer trả về verified: true trong phiên này → ToolError BLOCKED, không thực thi.
// Mọi handler nhận `state` của MỘT phiên; cổng chặn đọc từ state, không đọc từ lời Claude nói.
import { readFileSync } from "node:fs";
import type { Tool } from "../lib/anthropic.ts";

export const SYSTEM = readFileSync(new URL("./system_prompt.txt", import.meta.url), "utf8");

export const TOOLS: Tool[] = [
  {
    name: "get_customer",
    description:
      "Tra và xác minh khách hàng bằng email + 4 số cuối điện thoại. " +
      "Trả về customer_id và verified (true/false). Bắt buộc gọi trước mọi thao tác tiền.",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email đăng ký" },
        phone_last4: { type: "string", pattern: "^[0-9]{4}$", description: "4 số cuối điện thoại" },
      },
      required: ["email", "phone_last4"],
    },
  },
  {
    name: "lookup_order",
    description: "Xem chi tiết đơn hàng (khách, số tiền, trạng thái, phương thức thanh toán).",
    input_schema: {
      type: "object",
      properties: { order_id: { type: "string", description: "Mã đơn, ví dụ 'ORD-1001'" } },
      required: ["order_id"],
    },
  },
  {
    name: "process_refund",
    description: "Hoàn tiền cho một đơn. Chỉ chạy được sau khi khách đã được xác minh trong phiên.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        order_id: { type: "string" },
        amount: { type: "number", exclusiveMinimum: 0, description: "Số tiền hoàn (USD)" },
        reason: { type: "string" },
      },
      required: ["customer_id", "order_id", "amount", "reason"],
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Chuyển cho nhân viên khi không tự giải quyết được. Bản tóm tắt phải tự đủ nghĩa: " +
      "người nhận không có transcript.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        conversation_summary: { type: "string", description: "Khách yêu cầu gì, đã làm gì" },
        root_cause_analysis: { type: "string", description: "Nguyên nhân gốc của từng vấn đề" },
        refund_amount: { type: "number", minimum: 0, description: "Tổng tiền đã/cần hoàn (USD), 0 nếu không có" },
        recommended_action: { type: "string", description: "Nhân viên cần làm gì tiếp theo" },
        concerns: {
          type: "array",
          description: "Từng vấn đề riêng của khách",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["return", "billing_dispute", "account_update", "other"] },
              detail: { type: "string" },
              status: { type: "string", enum: ["resolved", "needs_human"] },
            },
            required: ["type", "detail", "status"],
          },
        },
      },
      required: ["customer_id", "conversation_summary", "root_cause_analysis", "refund_amount", "recommended_action", "concerns"],
    },
  },
];

// ---------- Dữ liệu GIẢ LẬP ----------
const CUSTOMERS: Record<string, { customer_id: string; phone_last4: string; name: string }> = {
  "an@example.com": { customer_id: "C-001", phone_last4: "6789", name: "Nguyễn An" },
};
const ORDERS: Record<string, { customer_id: string; amount: number; status: string; item: string; payment: string }> = {
  "ORD-1001": { customer_id: "C-001", amount: 120.0, status: "delivered", item: "Tai nghe", payment: "visa-4242" },
  "ORD-1002": { customer_id: "C-001", amount: 45.0, status: "delivered", item: "Ốp lưng", payment: "visa-4242" },
  "ORD-2001": { customer_id: "C-002", amount: 300.0, status: "delivered", item: "Loa", payment: "mc-5555" },
};

// Trạng thái của MỘT phiên hội thoại — cổng chặn đọc từ đây.
export interface SessionState {
  verified_customer_id: string | null;
  ledger: { order_id: string; amount: number; reason: unknown }[]; // mọi refund ĐÃ thực thi
  handoffs: Record<string, unknown>[];
}

export const newState = (): SessionState => ({ verified_customer_id: null, ledger: [], handoffs: [] });

export class ToolError extends Error {
  blocked: boolean;
  constructor(message: string, blocked = false) {
    super(message);
    this.blocked = blocked;
  }
}

const PLACEHOLDER = /^\s*(tbd|todo|n\/?a|unknown|none|null|-+|\.{3}|…|\?+)?\s*$/i;
const isPlaceholder = (v: unknown) => PLACEHOLDER.test(String(v ?? ""));

type Args = Record<string, unknown>;

function getCustomer(state: SessionState, args: Args) {
  const c = CUSTOMERS[String(args.email ?? "").toLowerCase()];
  if (!c) return { verified: false, message: "Không tìm thấy khách với email này" };
  if (c.phone_last4 !== String(args.phone_last4 ?? ""))
    return { verified: false, customer_id: c.customer_id, message: "Sai 4 số cuối điện thoại" };

  state.verified_customer_id = c.customer_id; // CHỈ set khi tool thật sự trả verified: true
  return { verified: true, customer_id: c.customer_id, name: c.name };
}

function lookupOrder(_state: SessionState, args: Args) {
  const o = ORDERS[String(args.order_id)];
  if (!o) throw new ToolError(`Không có đơn ${args.order_id}`);
  return { ...o, order_id: args.order_id };
}

// ---- PREREQUISITE GATE ----
function processRefund(state: SessionState, args: Args) {
  const verified = state.verified_customer_id;
  const customerId = String(args.customer_id);
  const orderId = String(args.order_id);
  const amount = Number(args.amount);
  if (!verified)
    throw new ToolError(
      "BLOCKED: chưa xác minh khách hàng trong phiên này. " +
        "Hãy gọi get_customer và nhận verified=true trước khi hoàn tiền.",
      true,
    );
  if (customerId !== verified)
    throw new ToolError(`BLOCKED: customer_id ${customerId} khác khách đã xác minh (${verified}).`, true);
  const o = ORDERS[orderId];
  if (!o) throw new ToolError(`Không có đơn ${orderId}`);
  if (o.customer_id !== customerId) throw new ToolError(`BLOCKED: đơn ${orderId} không thuộc khách ${customerId}.`, true);
  if (amount > o.amount) throw new ToolError(`Số tiền ${amount} vượt giá trị đơn ${o.amount}.`);

  state.ledger.push({ order_id: orderId, amount, reason: args.reason }); // side effect thật
  return { status: "refunded", refund_id: `RF-${state.ledger.length}`, order_id: orderId, amount };
}

// ---- STRUCTURED HANDOFF ----
function escalateToHuman(state: SessionState, args: Args) {
  const keys = ["customer_id", "conversation_summary", "root_cause_analysis", "recommended_action"] as const;
  const fields = Object.fromEntries(keys.map((k) => [k, args[k]]));
  const bad: string[] = keys.filter((k) => isPlaceholder(args[k]));
  const refundAmount = args.refund_amount;
  if (!(typeof refundAmount === "number" && refundAmount >= 0)) bad.push("refund_amount");
  const concerns = Array.isArray(args.concerns) ? (args.concerns as unknown[]) : [];
  if (concerns.length === 0 || concerns.some((c) => (c && typeof c === "object" ? isPlaceholder((c as Args).detail) : true)))
    bad.push("concerns");
  if (bad.length) throw new ToolError(`Handoff bị từ chối – trường rỗng/placeholder: ${bad.join(", ")}. Hãy điền cụ thể.`);

  const ticket = {
    ticket_id: `HO-${String(state.handoffs.length + 1).padStart(4, "0")}`,
    ...fields,
    refund_amount: refundAmount,
    concerns,
  };
  state.handoffs.push(ticket);
  return { status: "escalated", ticket_id: ticket.ticket_id };
}

const HANDLERS: Record<string, (state: SessionState, args: Args) => object> = {
  get_customer: getCustomer,
  lookup_order: lookupOrder,
  process_refund: processRefund,
  escalate_to_human: escalateToHuman,
};

export const isTool = (name: string) => name in HANDLERS;

/** Gọi handler: thiếu tham số bắt buộc hoặc tool lạ → ToolError (lỗi có cấu trúc, Claude đọc được).
 *  escalate_to_human tự kiểm đủ trường bằng validator (để báo đủ danh sách trường còn thiếu). */
export function callTool(state: SessionState, name: string, args: Args): object {
  const handler = HANDLERS[name];
  if (!handler) throw new ToolError(`Tool không tồn tại: ${name}`);
  const required =
    name === "escalate_to_human" ? [] : ((TOOLS.find((t) => t.name === name)!.input_schema.required as string[]) ?? []);
  const missing = required.filter((k) => args[k] === undefined || args[k] === null);
  if (missing.length) throw new ToolError(`Thiếu tham số bắt buộc: ${missing.join(", ")}`);
  return handler(state, args);
}
