#!/usr/bin/env ruby
# frozen_string_literal: true

# Bài 2.1 – MCP server "shop" (stdio, JSON-RPC 2.0, Ruby thuần, không cần gem).
#
# Hai tool: get_customer, lookup_order. Bộ mô tả chọn bằng biến môi trường:
#   TOOLSET=vague  : mô tả 1 câu, chồng lấn, cả hai nhận chung field `query` (tái hiện misrouting)
#   TOOLSET=clear  : mô tả 3–5 câu đủ 5 yếu tố + schema tách field rõ ràng
# SHOP_LOG=<file>  : mỗi tools/call ghi 1 dòng JSON (tool, arguments, toolset, thời điểm)
#
# Dữ liệu là dữ liệu GIẢ, chỉ để agent có kết quả hợp lý mà trả lời.

require "json"
require "time"

TOOLSET = ENV.fetch("TOOLSET", "vague")
LOG_FILE = ENV["SHOP_LOG"]

CUSTOMERS = [
  { customer_id: "CUS-0042", name: "Nguyễn Thị Lan", email: "lan.nguyen@example.vn", phone: "0912345678",
    tier: "Vàng", points: 1240, joined: "2024-03-18", recent_orders: ["#12345", "#31007"] },
  { customer_id: "CUS-0117", name: "Trần Văn Minh", email: "minh.tran@example.vn", phone: "0987654321",
    tier: "Bạc", points: 380, joined: "2025-07-02", recent_orders: ["#20871", "#45210"] }
].freeze

ORDERS = [
  { order_number: "#12345", customer_id: "CUS-0042", status: "Đang giao", carrier: "GHN", tracking_id: "GHN-5521093",
    eta: "2026-10-14", paid: true, ship_to: "12 Lê Lợi, Q.1, TP.HCM", items: ["Nồi chiên không dầu 5L"] },
  { order_number: "#20871", customer_id: "CUS-0117", status: "Đã đóng gói", carrier: "GHN", tracking_id: "GHN-8842137",
    eta: "2026-10-16", paid: false, ship_to: "45 Trần Phú, Hà Đông, Hà Nội", items: ["Bàn phím cơ", "Lót chuột"] },
  { order_number: "#31007", customer_id: "CUS-0042", status: "Đã giao", carrier: "GHTK", tracking_id: "GHTK-770215",
    eta: "2026-10-05", paid: true, ship_to: "88 Nguyễn Huệ, Q.1, TP.HCM", items: ["Máy xay sinh tố"] },
  { order_number: "#45210", customer_id: "CUS-0117", status: "Chờ xác nhận", carrier: "GHTK", tracking_id: nil,
    eta: nil, paid: true, ship_to: "45 Trần Phú, Hà Đông, Hà Nội", items: ["Tai nghe bluetooth", "Cáp sạc USB-C"] }
].freeze

VAGUE_TOOLS = [
  { name: "get_customer",
    description: "Lấy thông tin khách hàng.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Thông tin cần tìm" } },
                   required: ["query"] } },
  { name: "lookup_order",
    description: "Lấy thông tin đơn hàng.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Thông tin cần tìm" } },
                   required: ["query"] } }
].freeze

CLEAR_TOOLS = [
  { name: "get_customer",
    description: <<~DESC.strip,
      Tra HỒ SƠ KHÁCH HÀNG (danh tính, hạng thành viên, điểm tích luỹ, ngày đăng ký, danh sách mã đơn gần đây) và dùng để xác minh danh tính khách.
      Input: truyền ĐÚNG MỘT trong ba field: customer_id dạng CUS-NNNN (vd CUS-0042), email, hoặc phone là số di động VN 10 chữ số (vd 0912345678).
      Ví dụ dùng: "khách CUS-0042 là ai", "SĐT 0912345678 hạng gì", "email lan@... có những đơn nào".
      Giới hạn: không trả trạng thái giao hàng hay chi tiết đơn; không tìm theo tên; không có kết quả thì trả lỗi not_found.
      KHÔNG dùng khi câu hỏi có mã đơn #NNNNN hoặc mã vận đơn: khi đó gọi lookup_order trực tiếp.
    DESC
    inputSchema: { type: "object",
                   properties: {
                     customer_id: { type: "string", pattern: "^CUS-\\d{4}$", description: "Mã khách, vd CUS-0042" },
                     email: { type: "string", description: "Email đăng ký của khách" },
                     phone: { type: "string", pattern: "^0\\d{9}$", description: "SĐT di động 10 số, vd 0912345678" }
                   } } },
  { name: "lookup_order",
    description: <<~DESC.strip,
      Tra CHI TIẾT MỘT ĐƠN HÀNG: trạng thái, đơn vị vận chuyển, ngày giao dự kiến, đã thanh toán chưa, địa chỉ giao, danh sách sản phẩm.
      Input: truyền ĐÚNG MỘT trong hai field: order_number dạng # + 5 chữ số (vd #12345), hoặc tracking_id là mã vận đơn của hãng vận chuyển (vd GHN-8842137, GHTK-770215).
      Ví dụ dùng: "đơn #12345 tới đâu rồi", "mã vận đơn GHN-8842137 giao chưa", "đơn #31007 giao tới địa chỉ nào".
      Giới hạn: không tìm đơn theo email, SĐT hay tên khách; nếu khách chỉ đưa email/SĐT thì gọi get_customer trước để lấy mã đơn.
      KHÔNG dùng để tra hồ sơ hay điểm của khách: đó là việc của get_customer.
    DESC
    inputSchema: { type: "object",
                   properties: {
                     order_number: { type: "string", pattern: "^#\\d{5}$", description: "Mã đơn, vd #12345" },
                     tracking_id: { type: "string", description: "Mã vận đơn, vd GHN-8842137" }
                   } } }
].freeze

TOOLS = TOOLSET == "clear" ? CLEAR_TOOLS : VAGUE_TOOLS

def log_call(name, args)
  return unless LOG_FILE

  File.open(LOG_FILE, "a") do |f|
    f.puts JSON.generate({ at: Time.now.iso8601, toolset: TOOLSET, tool: name, arguments: args })
  end
end

# Ở bản vague, field `query` là chuỗi tự do: dò mọi kiểu định danh trong chuỗi.
def find_customer(args)
  q = [args["customer_id"], args["email"], args["phone"], args["query"]].compact.join(" ")
  CUSTOMERS.find do |c|
    q.include?(c[:customer_id]) || q.downcase.include?(c[:email]) || q.gsub(/\D/, "").include?(c[:phone])
  end
end

def find_order(args)
  q = [args["order_number"], args["tracking_id"], args["query"]].compact.join(" ")
  ORDERS.find { |o| q.include?(o[:order_number]) || (o[:tracking_id] && q.include?(o[:tracking_id])) }
end

def call_tool(name, args)
  log_call(name, args)
  result =
    case name
    when "get_customer" then find_customer(args)
    when "lookup_order" then find_order(args)
    else return { content: [{ type: "text", text: JSON.generate({ error: "unknown_tool", tool: name }) }], isError: true }
    end
  if result
    { content: [{ type: "text", text: JSON.generate(result) }] }
  else
    { content: [{ type: "text", text: JSON.generate({ error: "not_found", input: args }) }], isError: true }
  end
end

def respond(id, result) = $stdout.puts(JSON.generate({ jsonrpc: "2.0", id: id, result: result }))

def respond_error(id, code, message)
  $stdout.puts(JSON.generate({ jsonrpc: "2.0", id: id, error: { code: code, message: message } }))
end

$stdout.sync = true
$stdin.each_line do |line|
  next if line.strip.empty?

  begin
    msg = JSON.parse(line)
  rescue JSON::ParserError
    respond_error(nil, -32_700, "Parse error")
    next
  end
  id = msg["id"]
  case msg["method"]
  when "initialize"
    respond(id, { protocolVersion: msg.dig("params", "protocolVersion") || "2025-06-18",
                  capabilities: { tools: {} },
                  serverInfo: { name: "shop", version: "1.0.0" } })
  when "notifications/initialized", "notifications/cancelled"
    nil # notification: không trả lời
  when "ping"
    respond(id, {})
  when "tools/list"
    respond(id, { tools: TOOLS })
  when "tools/call"
    respond(id, call_tool(msg.dig("params", "name"), msg.dig("params", "arguments") || {}))
  else
    respond_error(id, -32_601, "Method not found: #{msg['method']}") unless id.nil?
  end
end
