// Build Exercise 1.5 — Agent SDK Hooks for Normalisation and Policy Enforcement
// TypeScript + @anthropic-ai/claude-agent-sdk (Agent SDK chỉ có bản TypeScript/Python, không có Ruby).
//
//   npm i @anthropic-ai/claude-agent-sdk zod
//   export ANTHROPIC_API_KEY=...
//   node --experimental-strip-types bai_1_5_sdk_hooks.ts --run
//   Không có API key: ./run_cli.sh (dùng phiên đăng nhập claude.ai của Claude Code CLI)
//
// Ý tưởng:
//   PreToolUse  = TRƯỚC khi tool chạy  → chặn chính sách (refund > $500, chuyển tiền khi chưa AML)
//   PostToolUse = SAU khi tool đã chạy → biến đổi dữ liệu (chuẩn hoá ngày/status) + ghi state AML
// Không dùng PostToolUse để chặn: lúc đó tool đã chạy xong, tiền đã đi rồi.

import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  createSdkMcpServer,
  query,
  tool,
  type HookCallback,
  type HookCallbackMatcher,
  type HookEvent,
  type HookJSONOutput,
  type PostToolUseHookInput,
  type PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

export const SERVER = "ops";
export const toolName = (short: string) => `mcp__${SERVER}__${short}`;

export const REFUND_LIMIT_USD = 500;

// ---------------------------------------------------------------------------
// State phía ứng dụng (không nằm trong prompt nên model không "quên" được)
// ---------------------------------------------------------------------------
export const LEDGER: string[] = []; // bằng chứng tool tiền tệ thật sự đã chạy
export const ESCALATIONS: { tool: string; input: unknown; reason: string }[] = []; // hàng đợi người duyệt
const amlPassed = new Set<string>(); // key = `${session_id}:${customer_id}`

export function resetState(): void {
  LEDGER.length = 0;
  ESCALATIONS.length = 0;
  amlPassed.clear();
}

// ---------------------------------------------------------------------------
// Bước 1: 3 tool dữ liệu, mỗi tool một định dạng ngày/status khác nhau
// ---------------------------------------------------------------------------
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });

export const handlers = {
  // Tool A — ERP cũ: Unix timestamp (giây) + mã status dạng số
  get_order: async ({ order_id }: { order_id: string }) =>
    json({ order_id, created_ts: 1790845200, status_code: 2 }),

  // Tool B — API vận chuyển: ISO 8601 + chuỗi tiếng Anh viết hoa/gạch dưới
  get_shipment: async ({ order_id }: { order_id: string }) =>
    json({ tracking_no: `SHP-${order_id}`, shipped_at: "2026-10-03T09:30:00+09:00", state: "IN_TRANSIT" }),

  // Tool C — cổng thanh toán: DD/MM/YYYY + mã 1 ký tự
  get_payment: async ({ order_id }: { order_id: string }) =>
    json({ payment_id: `PAY-${order_id}`, paid_on: "02/10/2026", st: "P" }),

  process_refund: async ({ order_id, amount_usd }: { order_id: string; amount_usd: number }) => {
    LEDGER.push(`refund ${order_id} $${amount_usd}`);
    return json({ order_id, refunded_usd: amount_usd, result: "ok" });
  },

  aml_check: async ({ customer_id }: { customer_id: string }) =>
    json({ customer_id, aml: customer_id.startsWith("BLOCKED") ? "fail" : "pass" }),

  transfer_funds: async ({ customer_id, amount_usd }: { customer_id: string; amount_usd: number }) => {
    LEDGER.push(`transfer ${customer_id} $${amount_usd}`);
    return json({ customer_id, transferred_usd: amount_usd, result: "ok" });
  },
};

const orderId = { order_id: z.string().describe("Mã đơn hàng, ví dụ ORD-1001") };

export const opsServer = createSdkMcpServer({
  name: SERVER,
  version: "1.0.0",
  tools: [
    tool("get_order", "Lấy thông tin đơn hàng (ngày tạo, trạng thái đơn).", orderId, handlers.get_order),
    tool("get_shipment", "Lấy trạng thái vận chuyển của đơn hàng.", orderId, handlers.get_shipment),
    tool("get_payment", "Lấy trạng thái thanh toán của đơn hàng.", orderId, handlers.get_payment),
    tool(
      "process_refund",
      "Hoàn tiền cho đơn hàng.",
      { order_id: z.string(), amount_usd: z.number().positive() },
      handlers.process_refund,
    ),
    tool("aml_check", "Kiểm tra chống rửa tiền (AML) cho khách hàng.", { customer_id: z.string() }, handlers.aml_check),
    tool(
      "transfer_funds",
      "Chuyển tiền cho khách hàng.",
      { customer_id: z.string(), amount_usd: z.number().positive() },
      handlers.transfer_funds,
    ),
  ],
});

// ---------------------------------------------------------------------------
// Bước 2: PostToolUse chuẩn hoá về 1 schema: date = ISO 8601 (UTC), status = tiếng Anh dễ đọc
// ---------------------------------------------------------------------------
const ORDER_STATUS: Record<number, string> = { 1: "pending", 2: "shipped", 3: "delivered", 4: "cancelled" };
const PAYMENT_STATUS: Record<string, string> = { P: "paid", N: "pending", F: "failed", R: "refunded" };

export function toIso(value: unknown): string {
  if (typeof value === "number") return new Date(value * 1000).toISOString(); // Unix giây
  if (typeof value === "string") {
    const dmy = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // DD/MM/YYYY, không có giờ → giả định 00:00 UTC
    if (dmy) return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1])).toISOString();
    const d = new Date(value); // ISO 8601 có múi giờ → đưa về UTC
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  throw new Error(`Không nhận dạng được ngày: ${JSON.stringify(value)}`);
}

const humanize = (s: string) => s.toLowerCase().replace(/_/g, " ");

type Row = Record<string, any>;
export const NORMALIZERS: Record<string, (r: Row) => Row> = {
  get_order: (r) => ({ source: "order", id: r.order_id, date: toIso(r.created_ts), status: ORDER_STATUS[r.status_code] ?? `unknown (${r.status_code})` }),
  get_shipment: (r) => ({ source: "shipment", id: r.tracking_no, date: toIso(r.shipped_at), status: humanize(r.state) }),
  get_payment: (r) => ({ source: "payment", id: r.payment_id, date: toIso(r.paid_on), status: PAYMENT_STATUS[r.st] ?? `unknown (${r.st})` }),
};

// tool_response của MCP tool có thể là chuỗi, mảng content block, hoặc { content: [...] } → đọc cả 3
function readPayload(resp: unknown): Row | null {
  const blocks = Array.isArray(resp) ? resp : (resp as any)?.content;
  const text = typeof resp === "string" ? resp : Array.isArray(blocks) ? blocks.find((b: any) => b?.type === "text")?.text : undefined;
  try {
    return typeof text === "string" ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// Trả lại đúng "hình dạng" đã nhận, chỉ thay nội dung
function writePayload(resp: unknown, data: Row): unknown {
  const text = JSON.stringify(data);
  if (typeof resp === "string") return text;
  if (Array.isArray(resp)) return [{ type: "text", text }];
  return { ...(resp as object), content: [{ type: "text", text }] };
}

const shortName = (full: string) => full.replace(`mcp__${SERVER}__`, "");

export const normalizeHook: HookCallback = async (input): Promise<HookJSONOutput> => {
  const post = input as PostToolUseHookInput;
  const normalize = NORMALIZERS[shortName(post.tool_name)];
  const raw = readPayload(post.tool_response);
  if (!normalize || !raw) return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      // updatedToolOutput: thay output trước khi model nhìn thấy (dùng được cho mọi tool;
      // updatedMCPToolOutput là trường cũ, chỉ cho MCP tool)
      updatedToolOutput: writePayload(post.tool_response, normalize(raw)),
    },
  };
};

// ---------------------------------------------------------------------------
// Bước 4: PreToolUse chặn refund > $500 → chuyển người duyệt
// ---------------------------------------------------------------------------
const deny = (reason: string): HookJSONOutput => ({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
});

export const refundLimitHook: HookCallback = async (input) => {
  const pre = input as PreToolUseHookInput;
  if (pre.tool_name !== toolName("process_refund")) return {};
  const args = pre.tool_input as { order_id?: string; amount_usd?: number };
  const amount = Number(args.amount_usd);
  if (!(amount <= REFUND_LIMIT_USD)) { // NaN cũng bị chặn
    const reason = `Refund $${args.amount_usd} vượt hạn mức $${REFUND_LIMIT_USD}. Không tự xử lý; đã chuyển cho nhân viên duyệt (escalation). Hãy báo khách là yêu cầu đang chờ duyệt.`;
    ESCALATIONS.push({ tool: pre.tool_name, input: args, reason });
    return deny(reason);
  }
  return {};
};

// ---------------------------------------------------------------------------
// Bước 5: AML — 2 hook phối hợp: PostToolUse(aml_check) ghi state, PreToolUse(transfer_funds) kiểm tra
// ---------------------------------------------------------------------------
export const amlRecordHook: HookCallback = async (input) => {
  const post = input as PostToolUseHookInput;
  const r = readPayload(post.tool_response);
  if (r?.aml === "pass") amlPassed.add(`${post.session_id}:${r.customer_id}`);
  return {};
};

export const amlGateHook: HookCallback = async (input) => {
  const pre = input as PreToolUseHookInput;
  const { customer_id } = pre.tool_input as { customer_id?: string };
  if (!amlPassed.has(`${pre.session_id}:${customer_id}`)) {
    return deny(`Chưa có aml_check PASS cho khách ${customer_id} trong phiên này. Gọi aml_check trước; nếu AML fail thì không được chuyển tiền.`);
  }
  return {};
};

export const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
  PreToolUse: [
    { matcher: toolName("process_refund"), hooks: [refundLimitHook] },
    { matcher: toolName("transfer_funds"), hooks: [amlGateHook] },
  ],
  PostToolUse: [
    { matcher: `^mcp__${SERVER}__get_`, hooks: [normalizeHook] },
    { matcher: toolName("aml_check"), hooks: [amlRecordHook] },
  ],
};

// ---------------------------------------------------------------------------
// Chạy thật (cần ANTHROPIC_API_KEY)
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const prompts = [
    "Đơn ORD-1001: cho tôi biết ngày tạo đơn, ngày gửi hàng, ngày thanh toán và trạng thái của từng thứ.",
    "Hoàn tiền $750 cho đơn ORD-1001 ngay.",
    "Chuyển $200 cho khách CUS-42.",
  ];
  for (const prompt of prompts) {
    console.log(`\n=== ${prompt}`);
    for await (const msg of query({
      prompt,
      options: {
        mcpServers: { [SERVER]: opsServer },
        allowedTools: Object.keys(handlers).map(toolName),
        hooks,
        maxTurns: 10,
        // Không có API key: trỏ SDK về CLI đã đăng nhập claude.ai (vd CLAUDE_BIN=$(which claude)).
        ...(process.env.CLAUDE_BIN ? { pathToClaudeCodeExecutable: process.env.CLAUDE_BIN } : {}),
      },
    })) {
      if (msg.type === "result") console.log(msg.subtype === "success" ? msg.result : `[${msg.subtype}]`);
    }
  }
  console.log("\nLEDGER:", LEDGER, "\nESCALATIONS:", ESCALATIONS.length);
}

if (process.argv.includes("--run") && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
