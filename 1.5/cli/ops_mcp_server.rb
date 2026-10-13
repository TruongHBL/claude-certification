#!/usr/bin/env ruby
# frozen_string_literal: true
# Bài 1.5 – bản CLI: MCP server stdio (Ruby thuần) với đúng 6 tool như bản SDK (server "ops").
# 3 tool dữ liệu cố tình trả 3 định dạng ngày/status khác nhau để hook PostToolUse chuẩn hoá.
# Tool tiền tệ ghi vào LEDGER_FILE: đây là bằng chứng tool THẬT SỰ đã chạy (bị hook chặn thì không có dòng nào).
require "json"

$stdout.sync = true
LEDGER_FILE = ENV["LEDGER_FILE"]

def ledger(line) = LEDGER_FILE && File.open(LEDGER_FILE, "a") { _1.puts(line) }
def text(data) = { content: [{ type: "text", text: JSON.generate(data) }] }

ORDER_ID = { type: "object", properties: { order_id: { type: "string", description: "Mã đơn hàng, ví dụ ORD-1001" } }, required: ["order_id"] }.freeze
MONEY = ->(id_field) { { type: "object", properties: { id_field => { type: "string" }, amount_usd: { type: "number", exclusiveMinimum: 0 } }, required: [id_field, "amount_usd"] } }

TOOLS = [
  { name: "get_order", description: "Lấy thông tin đơn hàng (ngày tạo, trạng thái đơn).", inputSchema: ORDER_ID },
  { name: "get_shipment", description: "Lấy trạng thái vận chuyển của đơn hàng.", inputSchema: ORDER_ID },
  { name: "get_payment", description: "Lấy trạng thái thanh toán của đơn hàng.", inputSchema: ORDER_ID },
  { name: "process_refund", description: "Hoàn tiền cho đơn hàng.", inputSchema: MONEY.("order_id") },
  { name: "aml_check", description: "Kiểm tra chống rửa tiền (AML) cho khách hàng.",
    inputSchema: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"] } },
  { name: "transfer_funds", description: "Chuyển tiền cho khách hàng.", inputSchema: MONEY.("customer_id") },
].freeze

def call_tool(name, a)
  case name
  when "get_order" then text(order_id: a["order_id"], created_ts: 1_790_845_200, status_code: 2)                       # Unix giây + mã số
  when "get_shipment" then text(tracking_no: "SHP-#{a['order_id']}", shipped_at: "2026-10-03T09:30:00+09:00", state: "IN_TRANSIT") # ISO + HOA_GẠCH
  when "get_payment" then text(payment_id: "PAY-#{a['order_id']}", paid_on: "02/10/2026", st: "P")                     # DD/MM/YYYY + 1 ký tự
  when "process_refund" then ledger("refund #{a['order_id']} $#{a['amount_usd']}"); text(order_id: a["order_id"], refunded_usd: a["amount_usd"], result: "ok")
  when "aml_check" then text(customer_id: a["customer_id"], aml: a["customer_id"].to_s.start_with?("BLOCKED") ? "fail" : "pass")
  when "transfer_funds" then ledger("transfer #{a['customer_id']} $#{a['amount_usd']}"); text(customer_id: a["customer_id"], transferred_usd: a["amount_usd"], result: "ok")
  end
end

def respond(id, result) = $stdout.puts(JSON.generate({ jsonrpc: "2.0", id: id, result: result }))
def respond_error(id, code, msg) = $stdout.puts(JSON.generate({ jsonrpc: "2.0", id: id, error: { code: code, message: msg } }))

$stdin.each_line do |line|
  msg = JSON.parse(line) rescue next
  id = msg["id"]
  case msg["method"]
  when "initialize"
    respond(id, { protocolVersion: msg.dig("params", "protocolVersion") || "2025-06-18", capabilities: { tools: {} },
                  serverInfo: { name: "ops", version: "1.0.0" } })
  when "notifications/initialized", "notifications/cancelled" then nil
  when "ping" then respond(id, {})
  when "tools/list" then respond(id, { tools: TOOLS })
  when "tools/call"
    name = msg.dig("params", "name")
    next respond_error(id, -32602, "Unknown tool: #{name}") unless TOOLS.any? { _1[:name] == name }
    respond(id, call_tool(name, msg.dig("params", "arguments") || {}))
  else
    respond_error(id, -32601, "Method not found: #{msg['method']}") if id
  end
end
