#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Bài 2.1 – MCP server "shop" (stdio, JSON-RPC 2.0, TypeScript, không cần thư viện ngoài).
//
// Hai tool: get_customer, lookup_order. Bộ mô tả chọn bằng biến môi trường:
//   TOOLSET=vague  : mô tả 1 câu, chồng lấn, cả hai nhận chung field `query` (tái hiện misrouting)
//   TOOLSET=clear  : mô tả 3–5 câu đủ 5 yếu tố + schema tách field rõ ràng
// SHOP_LOG=<file>  : mỗi tools/call ghi 1 dòng JSON (tool, arguments, toolset, thời điểm)
//
// Dữ liệu là dữ liệu GIẢ, chỉ để agent có kết quả hợp lý mà trả lời.
import { appendFileSync } from "node:fs";
import { runServer, textResult, type ToolDef, type ToolResult } from "../lib/mcp_server.ts";

const TOOLSET = process.env.TOOLSET ?? "vague";
const LOG_FILE = process.env.SHOP_LOG;

const CUSTOMERS = [
  { customer_id: "CUS-0042", name: "Nguyễn Thị Lan", email: "lan.nguyen@example.vn", phone: "0912345678",
    tier: "Vàng", points: 1240, joined: "2024-03-18", recent_orders: ["#12345", "#31007"] },
  { customer_id: "CUS-0117", name: "Trần Văn Minh", email: "minh.tran@example.vn", phone: "0987654321",
    tier: "Bạc", points: 380, joined: "2025-07-02", recent_orders: ["#20871", "#45210"] },
];

const ORDERS = [
  { order_number: "#12345", customer_id: "CUS-0042", status: "Đang giao", carrier: "GHN", tracking_id: "GHN-5521093",
    eta: "2026-10-14", paid: true, ship_to: "12 Lê Lợi, Q.1, TP.HCM", items: ["Nồi chiên không dầu 5L"] },
  { order_number: "#20871", customer_id: "CUS-0117", status: "Đã đóng gói", carrier: "GHN", tracking_id: "GHN-8842137",
    eta: "2026-10-16", paid: false, ship_to: "45 Trần Phú, Hà Đông, Hà Nội", items: ["Bàn phím cơ", "Lót chuột"] },
  { order_number: "#31007", customer_id: "CUS-0042", status: "Đã giao", carrier: "GHTK", tracking_id: "GHTK-770215",
    eta: "2026-10-05", paid: true, ship_to: "88 Nguyễn Huệ, Q.1, TP.HCM", items: ["Máy xay sinh tố"] },
  { order_number: "#45210", customer_id: "CUS-0117", status: "Chờ xác nhận", carrier: "GHTK", tracking_id: null,
    eta: null, paid: true, ship_to: "45 Trần Phú, Hà Đông, Hà Nội", items: ["Tai nghe bluetooth", "Cáp sạc USB-C"] },
];

const VAGUE_TOOLS: ToolDef[] = [
  { name: "get_customer",
    description: "Lấy thông tin khách hàng.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Thông tin cần tìm" } },
                   required: ["query"] } },
  { name: "lookup_order",
    description: "Lấy thông tin đơn hàng.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Thông tin cần tìm" } },
                   required: ["query"] } },
];

// Mô tả giữ NGUYÊN VĂN bản Ruby đã dùng khi chạy thật (13/10/2026), để kết quả trong results/ vẫn có giá trị.
const CLEAR_TOOLS: ToolDef[] = [
  { name: "get_customer",
    description: [
      "Tra HỒ SƠ KHÁCH HÀNG (danh tính, hạng thành viên, điểm tích luỹ, ngày đăng ký, danh sách mã đơn gần đây) và dùng để xác minh danh tính khách.",
      "Input: truyền ĐÚNG MỘT trong ba field: customer_id dạng CUS-NNNN (vd CUS-0042), email, hoặc phone là số di động VN 10 chữ số (vd 0912345678).",
      "Ví dụ dùng: \"khách CUS-0042 là ai\", \"SĐT 0912345678 hạng gì\", \"email lan@... có những đơn nào\".",
      "Giới hạn: không trả trạng thái giao hàng hay chi tiết đơn; không tìm theo tên; không có kết quả thì trả lỗi not_found.",
      "KHÔNG dùng khi câu hỏi có mã đơn #NNNNN hoặc mã vận đơn: khi đó gọi lookup_order trực tiếp.",
    ].join("\n"),
    inputSchema: { type: "object",
                   properties: {
                     customer_id: { type: "string", pattern: "^CUS-\\d{4}$", description: "Mã khách, vd CUS-0042" },
                     email: { type: "string", description: "Email đăng ký của khách" },
                     phone: { type: "string", pattern: "^0\\d{9}$", description: "SĐT di động 10 số, vd 0912345678" },
                   } } },
  { name: "lookup_order",
    description: [
      "Tra CHI TIẾT MỘT ĐƠN HÀNG: trạng thái, đơn vị vận chuyển, ngày giao dự kiến, đã thanh toán chưa, địa chỉ giao, danh sách sản phẩm.",
      "Input: truyền ĐÚNG MỘT trong hai field: order_number dạng # + 5 chữ số (vd #12345), hoặc tracking_id là mã vận đơn của hãng vận chuyển (vd GHN-8842137, GHTK-770215).",
      "Ví dụ dùng: \"đơn #12345 tới đâu rồi\", \"mã vận đơn GHN-8842137 giao chưa\", \"đơn #31007 giao tới địa chỉ nào\".",
      "Giới hạn: không tìm đơn theo email, SĐT hay tên khách; nếu khách chỉ đưa email/SĐT thì gọi get_customer trước để lấy mã đơn.",
      "KHÔNG dùng để tra hồ sơ hay điểm của khách: đó là việc của get_customer.",
    ].join("\n"),
    inputSchema: { type: "object",
                   properties: {
                     order_number: { type: "string", pattern: "^#\\d{5}$", description: "Mã đơn, vd #12345" },
                     tracking_id: { type: "string", description: "Mã vận đơn, vd GHN-8842137" },
                   } } },
];

export const TOOLS = TOOLSET === "clear" ? CLEAR_TOOLS : VAGUE_TOOLS;

type Args = Record<string, unknown>;
const joinArgs = (args: Args, keys: string[]) =>
  keys.map((k) => args[k]).filter((v) => v != null).map(String).join(" ");

// Ở bản vague, field `query` là chuỗi tự do: dò mọi kiểu định danh trong chuỗi.
function findCustomer(args: Args) {
  const q = joinArgs(args, ["customer_id", "email", "phone", "query"]);
  return CUSTOMERS.find((c) =>
    q.includes(c.customer_id) || q.toLowerCase().includes(c.email) || q.replace(/\D/g, "").includes(c.phone));
}

function findOrder(args: Args) {
  const q = joinArgs(args, ["order_number", "tracking_id", "query"]);
  return ORDERS.find((o) => q.includes(o.order_number) || (o.tracking_id != null && q.includes(o.tracking_id)));
}

function respond(found: object | undefined, args: Args): ToolResult {
  return found ? textResult(found) : textResult({ error: "not_found", input: args }, { isError: true });
}

runServer({
  name: "shop",
  tools: TOOLS,
  onCall: (tool, args) => {
    if (LOG_FILE) {
      appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), toolset: TOOLSET, tool, arguments: args }) + "\n");
    }
  },
  handlers: {
    get_customer: (args) => respond(findCustomer(args), args),
    lookup_order: (args) => respond(findOrder(args), args),
  },
});
