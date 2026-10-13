#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Bài 2.2 – MCP server "support" (stdio, JSON-RPC 2.0, TypeScript, không cần thư viện ngoài).
//
// Hai tool:
//   get_customer(customer_id, simulate?)  – tra hồ sơ khách trong DB giả
//   process_refund(customer_id, amount)   – hoàn tiền, hạn mức tự động 500 USD
//
// Hai lớp lỗi:
//   1. Protocol error (JSON-RPC `error`): tool không tồn tại, thiếu tham số bắt buộc. Không có tool nào chạy,
//      model không nhận được tool result. Sửa ở schema/client, không phải ở vòng hồi phục của agent.
//   2. Tool execution error (`result.isError: true`): tool đã chạy nhưng thất bại. Metadata nằm trong
//      structuredContent: { errorCategory, isRetryable, description }. Đây là QUY ƯỚC CỦA ỨNG DỤNG,
//      MCP spec chỉ định nghĩa content / structuredContent / isError.
//
// Lớp JSON-RPC viết tay ngay trong file (không dùng lib/mcp_server.ts) để thấy rõ chỗ tách hai lớp lỗi:
// kiểm tool tồn tại + tham số bắt buộc → `error`; còn lại → `result`.
//
// Lưu ý: customer_id KHÔNG khai báo `pattern` trong inputSchema. Nếu schema chặn định dạng thì client/SDK
// có thể từ chối ngay ở lớp giao thức và agent không bao giờ thấy lỗi validation có hướng dẫn sửa.
// Định dạng được kiểm trong code để trả lỗi validation có cấu trúc.
//
// Tham số simulate (chỉ để kích hoạt lỗi theo yêu cầu):
//   none (mặc định) | timeout (luôn timeout) | flaky:N (N lần đầu timeout, sau đó chạy bình thường)
//   | permission (giả lập service account bị thu quyền)
//
// Biến môi trường:
//   ERROR_STYLE=structured (mặc định) | bad   – bad: mọi lỗi chỉ là chuỗi "Error", kết quả rỗng cũng là "Error"
//   SUPPORT_LOG=<file>                         – mỗi tools/call ghi 1 dòng JSON
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { ToolDef, ToolResult } from "../lib/mcp_server.ts";

const ERROR_STYLE = process.env.ERROR_STYLE ?? "structured";
const LOG_FILE = process.env.SUPPORT_LOG;
const REFUND_LIMIT = 500;

interface Customer {
  customer_id: string; name: string; tier: string; balance_usd: number; orders: string[]; restricted: boolean;
}

// Dữ liệu GIẢ.
const CUSTOMERS: Record<string, Customer> = {
  "CUS-0012": { customer_id: "CUS-0012", name: "Nguyễn Thị Lan", tier: "Vàng", balance_usd: 120.0,
                orders: ["#12345", "#31007"], restricted: false },
  "CUS-0042": { customer_id: "CUS-0042", name: "Trần Văn Minh", tier: "Bạc", balance_usd: 0.0,
                orders: ["#20871"], restricted: false },
  // Hồ sơ thuộc nhóm tài chính bị hạn chế: service account của agent không có quyền đọc.
  "CUS-0777": { customer_id: "CUS-0777", name: "Công ty TNHH Hoà Phát Đạt", tier: "Doanh nghiệp",
                balance_usd: 15_400.0, orders: ["#45210"], restricted: true },
};

const TOOLS: (ToolDef & { inputSchema: { required: string[] } })[] = [
  { name: "get_customer",
    description: [
      "Tra hồ sơ khách hàng theo mã khách dạng CUS-NNNN (vd CUS-0012): tên, hạng, số dư, danh sách mã đơn.",
      "Không có khách khớp thì trả kết quả rỗng (resultCount = 0, KHÔNG phải lỗi): đừng gọi lại, hãy báo không tìm thấy.",
      "Khi lỗi, structuredContent có errorCategory, isRetryable, description: làm theo description.",
    ].join("\n"),
    inputSchema: { type: "object",
                   properties: {
                     customer_id: { type: "string", description: "Mã khách dạng CUS-NNNN, vd CUS-0012" },
                     simulate: { type: "string", description: "Chỉ dùng khi test: none | timeout | flaky:N | permission" },
                   },
                   required: ["customer_id"] } },
  { name: "process_refund",
    description: [
      `Hoàn tiền cho khách (USD). Tự động duyệt tối đa ${REFUND_LIMIT} USD; vượt hạn mức trả lỗi business, không gọi lại mà chuyển quản lý duyệt.`,
      "Input: customer_id dạng CUS-NNNN, amount là số dương.",
    ].join("\n"),
    inputSchema: { type: "object",
                   properties: {
                     customer_id: { type: "string", description: "Mã khách dạng CUS-NNNN" },
                     amount: { type: "number", description: "Số tiền hoàn (USD), > 0" },
                   },
                   required: ["customer_id", "amount"] } },
];

const ID_FORMAT = /^CUS-\d{4}$/;
const flakyCounts = new Map<string, number>(); // (customer_id, simulate) → số lần đã gọi, để flaky:N hết lỗi sau N lần

type Args = Record<string, unknown>;

function logCall(name: string, args: Args): void {
  if (LOG_FILE) appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), tool: name, arguments: args }) + "\n");
}

// ---- Hai kiểu trả lỗi -------------------------------------------------------------------------

type Category = "transient" | "validation" | "business" | "permission";

function toolError(category: Category, retryable: boolean, description: string): ToolResult {
  if (ERROR_STYLE === "bad") return { content: [{ type: "text", text: "Error" }], isError: true };

  const meta = { errorCategory: category, isRetryable: retryable, description };
  return { content: [{ type: "text", text: JSON.stringify(meta) }], structuredContent: meta, isError: true };
}

function toolOk(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: false };
}

function validEmpty(customerId: string): ToolResult {
  // Bản bad: "không có kết quả" trông y hệt lỗi, agent không phân biệt được.
  if (ERROR_STYLE === "bad") return { content: [{ type: "text", text: "Error" }], isError: true };

  return toolOk({ results: [], resultCount: 0,
    message: `Truy vấn đã chạy thành công, không có khách nào có mã ${customerId}. Không cần gọi lại.` });
}

// ---- Các lỗi theo 4 loại ----------------------------------------------------------------------

const transientTimeout = () =>
  toolError("transient", true,
    "Kết nối DB khách hàng bị timeout sau 5s, truy vấn CHƯA chạy (dữ liệu có thể vẫn tồn tại). " +
    "Yêu cầu hợp lệ: gọi lại nguyên văn sau vài trăm ms.");

const validationBadId = (raw: string) =>
  toolError("validation", false,
    `customer_id '${raw}' sai định dạng. Định dạng đúng: CUS + gạch ngang + 4 chữ số, vd CUS-0012. ` +
    "Gọi lại y nguyên sẽ lỗi tiếp: hãy sửa input rồi gọi lại, hoặc hỏi lại khách mã đúng.");

const permissionDenied = (customerId: string) =>
  toolError("permission", false,
    `Service account support-bot không có quyền đọc hồ sơ tài chính của ${customerId}. ` +
    "Gọi lại với cùng tài khoản sẽ vẫn bị từ chối: chuyển cho nhân viên cấp cao có quyền finance-read.");

function simulatedFailure(customerId: string, simulate: unknown): ToolResult | null {
  if (simulate == null || simulate === "" || simulate === "none") return null;
  if (simulate === "timeout") return transientTimeout();
  if (simulate === "permission") return permissionDenied(customerId);
  const m = /^flaky:(\d+)$/.exec(String(simulate));
  if (m) {
    const key = `${customerId}|${simulate}`;
    const n = (flakyCounts.get(key) ?? 0) + 1;
    flakyCounts.set(key, n);
    return n <= Number(m[1]) ? transientTimeout() : null;
  }
  return toolError("validation", false,
    `simulate '${simulate}' không hợp lệ. Giá trị cho phép: none, timeout, flaky:N, permission.`);
}

function getCustomer(args: Args): ToolResult {
  const id = String(args.customer_id ?? "");
  if (!ID_FORMAT.test(id)) return validationBadId(id);

  const failure = simulatedFailure(id, args.simulate);
  if (failure) return failure;

  const customer = CUSTOMERS[id];
  if (!customer) return validEmpty(id);
  if (customer.restricted) return permissionDenied(id);

  const { restricted: _, ...visible } = customer;
  return toolOk({ results: [visible], resultCount: 1 });
}

function processRefund(args: Args): ToolResult {
  const id = String(args.customer_id ?? "");
  const amount = args.amount;
  if (!ID_FORMAT.test(id)) return validationBadId(id);
  if (typeof amount !== "number" || !(amount > 0)) {
    return toolError("validation", false, `amount '${amount}' không hợp lệ: phải là số dương (USD), vd 49.5.`);
  }

  const customer = CUSTOMERS[id];
  if (!customer) {
    return toolError("validation", false,
      `Không có khách ${id} nên không thể hoàn tiền. Kiểm tra lại mã khách bằng get_customer trước.`);
  }
  if (customer.restricted) return permissionDenied(id);

  if (amount > REFUND_LIMIT) {
    return toolError("business", false,
      `Khoản hoàn ${amount.toFixed(2)} USD vượt hạn mức tự động ${REFUND_LIMIT} USD, cần quản lý duyệt. ` +
      "KHÔNG gọi lại: tạo yêu cầu duyệt cho quản lý kèm mã khách, số tiền, lý do; " +
      "báo khách rằng yêu cầu đang chờ duyệt trong 1 ngày làm việc.");
  }

  return toolOk({ refund_id: `RF-${id.slice(-4)}-${Math.trunc(amount * 100)}`, customer_id: id, amount_usd: amount,
                  status: "approved" });
}

const HANDLERS: Record<string, (args: Args) => ToolResult> = { get_customer: getCustomer, process_refund: processRefund };

// ---- JSON-RPC ---------------------------------------------------------------------------------

type Id = number | string | null | undefined;
const write = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
const respond = (id: Id, result: unknown) => write({ jsonrpc: "2.0", id, result });
const respondError = (id: Id, code: number, message: string) =>
  write({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg: { id?: Id; method?: string; params?: Record<string, any> };
  try {
    msg = JSON.parse(line);
  } catch {
    respondError(null, -32700, "Parse error");
    return;
  }
  const { id, method, params = {} } = msg;
  switch (method) {
    case "initialize":
      respond(id, { protocolVersion: params.protocolVersion ?? "2025-06-18",
                    capabilities: { tools: {} }, serverInfo: { name: "support", version: "1.0.0" } });
      return;
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      respond(id, {});
      return;
    case "tools/list":
      respond(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const name = String(params.name ?? "");
      const args: Args = params.arguments ?? {};
      const tool = TOOLS.find((t) => t.name === name);
      // Lớp 1 – protocol error: tool không tồn tại hoặc thiếu tham số bắt buộc → tool không chạy.
      if (!tool) {
        respondError(id, -32602, `Unknown tool: ${name}`);
        return;
      }
      const missing = tool.inputSchema.required.filter((k) => !(k in args));
      if (missing.length) {
        respondError(id, -32602, `Invalid params for ${name}: missing ${missing.join(", ")}`);
        return;
      }
      // Lớp 2 – tool chạy; lỗi (nếu có) nằm trong result.isError.
      logCall(name, args);
      respond(id, HANDLERS[name](args));
      return;
    }
    default:
      if (id != null) respondError(id, -32601, `Method not found: ${method}`);
  }
});
