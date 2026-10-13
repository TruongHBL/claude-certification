#!/usr/bin/env ruby
# frozen_string_literal: true

# Bài 1.4 – bản CLI: MCP server "support" (stdio, JSON-RPC 2.0, Ruby thuần, không cần gem).
#
# Cùng 4 tool, cùng dữ liệu giả và cùng logic với bai_1_4_prerequisite_gate.rb, nhưng chạy dưới
# Claude Code CLI (`claude -p --mcp-config …`) thay vì vòng lặp Messages API tự viết.
#
# PREREQUISITE GATE nằm trong CODE của server (handler process_refund), không nằm trong prompt:
#   chưa có get_customer trả verified: true trong phiên này → trả isError + BLOCKED, không thực thi.
# Trạng thái phiên (khách đã xác minh, ledger refund đã thực thi, handoff) ghi ra file STATE_FILE,
# vì mỗi lệnh `claude -p` khởi chạy server mới: một file state = một phiên hội thoại.
#
# Biến môi trường:
#   STATE_FILE=<file>    trạng thái phiên (JSON), đọc lại mỗi lần gọi tool
#   SUPPORT_LOG=<file>   mỗi tools/call ghi 1 dòng JSON: tool, arguments, kết quả, isError

require "json"
require "time"

STATE_FILE = ENV["STATE_FILE"]
LOG_FILE = ENV["SUPPORT_LOG"]

TOOLS = [
  { name: "get_customer",
    description: "Tra và xác minh khách hàng bằng email + 4 số cuối điện thoại. " \
                 "Trả về customer_id và verified (true/false). Bắt buộc gọi trước mọi thao tác tiền.",
    inputSchema: { type: "object",
                   properties: {
                     email: { type: "string", description: "Email đăng ký" },
                     phone_last4: { type: "string", pattern: "^[0-9]{4}$", description: "4 số cuối điện thoại" }
                   },
                   required: %w[email phone_last4] } },
  { name: "lookup_order",
    description: "Xem chi tiết đơn hàng (khách, số tiền, trạng thái, phương thức thanh toán).",
    inputSchema: { type: "object",
                   properties: { order_id: { type: "string", description: "Mã đơn, ví dụ 'ORD-1001'" } },
                   required: ["order_id"] } },
  { name: "process_refund",
    description: "Hoàn tiền cho một đơn. Chỉ chạy được sau khi khách đã được xác minh trong phiên.",
    inputSchema: { type: "object",
                   properties: {
                     customer_id: { type: "string" },
                     order_id: { type: "string" },
                     amount: { type: "number", exclusiveMinimum: 0, description: "Số tiền hoàn (USD)" },
                     reason: { type: "string" }
                   },
                   required: %w[customer_id order_id amount reason] } },
  { name: "escalate_to_human",
    description: "Chuyển cho nhân viên khi không tự giải quyết được. Bản tóm tắt phải tự đủ nghĩa: " \
                 "người nhận không có transcript.",
    inputSchema: {
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
              type: { type: "string", enum: %w[return billing_dispute account_update other] },
              detail: { type: "string" },
              status: { type: "string", enum: %w[resolved needs_human] }
            },
            required: %w[type detail status]
          }
        }
      },
      required: %w[customer_id conversation_summary root_cause_analysis refund_amount recommended_action concerns]
    } }
].freeze

# ---------- Dữ liệu GIẢ LẬP (giống bản gốc) ----------
CUSTOMERS = {
  "an@example.com" => { customer_id: "C-001", phone_last4: "6789", name: "Nguyễn An" }
}.freeze
ORDERS = {
  "ORD-1001" => { customer_id: "C-001", amount: 120.0, status: "delivered", item: "Tai nghe", payment: "visa-4242" },
  "ORD-1002" => { customer_id: "C-001", amount: 45.0, status: "delivered", item: "Ốp lưng", payment: "visa-4242" },
  "ORD-2001" => { customer_id: "C-002", amount: 300.0, status: "delivered", item: "Loa", payment: "mc-5555" }
}.freeze

PLACEHOLDER = %r{\A\s*(tbd|todo|n/?a|unknown|none|null|-+|\.{3}|…|\?+)?\s*\z}i

class ToolError < StandardError
  attr_reader :blocked

  def initialize(msg, blocked: false)
    super(msg)
    @blocked = blocked
  end
end

# Trạng thái MỘT phiên — cổng chặn đọc từ đây, không đọc từ lời Claude nói.
def load_state
  return { "verified_customer_id" => nil, "ledger" => [], "handoffs" => [] } unless STATE_FILE && File.exist?(STATE_FILE)

  JSON.parse(File.read(STATE_FILE))
end

def save_state(state)
  File.write(STATE_FILE, JSON.pretty_generate(state)) if STATE_FILE
end

def get_customer(state, args)
  c = CUSTOMERS[args["email"].to_s.downcase]
  return { verified: false, message: "Không tìm thấy khách với email này" } unless c
  return { verified: false, customer_id: c[:customer_id], message: "Sai 4 số cuối điện thoại" } unless c[:phone_last4] == args["phone_last4"].to_s

  state["verified_customer_id"] = c[:customer_id] # CHỈ set khi tool thật sự trả verified: true
  { verified: true, customer_id: c[:customer_id], name: c[:name] }
end

def lookup_order(_state, args)
  o = ORDERS[args["order_id"]] or raise ToolError, "Không có đơn #{args['order_id']}"
  o.merge(order_id: args["order_id"])
end

# ---- PREREQUISITE GATE ----
def process_refund(state, args)
  verified = state["verified_customer_id"]
  customer_id = args["customer_id"]
  order_id = args["order_id"]
  amount = args["amount"].to_f
  unless verified
    raise ToolError.new("BLOCKED: chưa xác minh khách hàng trong phiên này. " \
                        "Hãy gọi get_customer và nhận verified=true trước khi hoàn tiền.", blocked: true)
  end
  if customer_id != verified
    raise ToolError.new("BLOCKED: customer_id #{customer_id} khác khách đã xác minh (#{verified}).", blocked: true)
  end
  o = ORDERS[order_id] or raise ToolError, "Không có đơn #{order_id}"
  raise ToolError.new("BLOCKED: đơn #{order_id} không thuộc khách #{customer_id}.", blocked: true) if o[:customer_id] != customer_id
  raise ToolError, "Số tiền #{amount} vượt giá trị đơn #{o[:amount]}." if amount > o[:amount]

  state["ledger"] << { "order_id" => order_id, "amount" => amount, "reason" => args["reason"] } # side effect thật
  { status: "refunded", refund_id: "RF-#{state['ledger'].size}", order_id: order_id, amount: amount }
end

# ---- STRUCTURED HANDOFF (validator giống bản gốc) ----
def escalate_to_human(state, args)
  fields = %w[customer_id conversation_summary root_cause_analysis recommended_action].to_h { |k| [k, args[k]] }
  bad = fields.select { |_, v| v.to_s.match?(PLACEHOLDER) }.keys
  refund_amount = args["refund_amount"]
  bad << "refund_amount" unless refund_amount.is_a?(Numeric) && refund_amount >= 0
  concerns = Array(args["concerns"])
  bad << "concerns" if concerns.empty? || concerns.any? { |c| c.is_a?(Hash) ? c["detail"].to_s.match?(PLACEHOLDER) : true }
  raise ToolError, "Handoff bị từ chối – trường rỗng/placeholder: #{bad.join(', ')}. Hãy điền cụ thể." if bad.any?

  ticket = fields.merge("ticket_id" => format("HO-%04d", state["handoffs"].size + 1),
                        "refund_amount" => refund_amount, "concerns" => concerns)
  state["handoffs"] << ticket
  { status: "escalated", ticket_id: ticket["ticket_id"] }
end

HANDLERS = { "get_customer" => :get_customer, "lookup_order" => :lookup_order,
             "process_refund" => :process_refund, "escalate_to_human" => :escalate_to_human }.freeze

def log_call(entry)
  return unless LOG_FILE

  File.open(LOG_FILE, "a") { |f| f.puts JSON.generate(entry.merge(at: Time.now.iso8601)) }
end

# Lỗi thực thi tool → result có isError: true (Claude đọc được và tự xử lý), không phải JSON-RPC error.
def call_tool(name, args)
  state = load_state
  handler = HANDLERS[name]
  unless handler
    log_call(tool: name, arguments: args, isError: true, blocked: false, result: "unknown_tool")
    return { content: [{ type: "text", text: "Tool không tồn tại: #{name}" }], isError: true }
  end
  begin
    out = send(handler, state, args)
    save_state(state)
    log_call(tool: name, arguments: args, isError: false, blocked: false, result: out)
    { content: [{ type: "text", text: JSON.generate(out) }] }
  rescue ToolError => e
    save_state(state)
    log_call(tool: name, arguments: args, isError: true, blocked: e.blocked, result: e.message)
    { content: [{ type: "text", text: e.message }], isError: true }
  end
end

def respond(id, result) = $stdout.puts(JSON.generate({ jsonrpc: "2.0", id: id, result: result }))

def respond_error(id, code, message)
  $stdout.puts(JSON.generate({ jsonrpc: "2.0", id: id, error: { code: code, message: message } }))
end

if $PROGRAM_NAME == __FILE__
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
                    capabilities: { tools: {} }, serverInfo: { name: "support", version: "1.0.0" } })
    when "notifications/initialized", "notifications/cancelled" then nil
    when "ping" then respond(id, {})
    when "tools/list" then respond(id, { tools: TOOLS })
    when "tools/call" then respond(id, call_tool(msg.dig("params", "name"), msg.dig("params", "arguments") || {}))
    else respond_error(id, -32_601, "Method not found: #{msg['method']}") unless id.nil?
    end
  end
end
