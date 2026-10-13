#!/usr/bin/env ruby
# frozen_string_literal: true
# PostToolUse(mcp__ops__get_*): chuẩn hoá 3 định dạng về 1 schema {source, id, date ISO-8601 UTC, status} TRƯỚC khi Claude thấy.
# updatedToolOutput: thay output cho mọi tool (Claude Code 2.1.296 có trong schema hook output);
# updatedMCPToolOutput là trường cũ chỉ cho MCP tool.
require_relative "lib"
require "time"

ORDER_STATUS = { 1 => "pending", 2 => "shipped", 3 => "delivered", 4 => "cancelled" }.freeze
PAYMENT_STATUS = { "P" => "paid", "N" => "pending", "F" => "failed", "R" => "refunded" }.freeze

def to_iso(v)
  return Time.at(v).utc.iso8601(3) if v.is_a?(Numeric)
  return Time.utc(Regexp.last_match(3).to_i, Regexp.last_match(2).to_i, Regexp.last_match(1).to_i).iso8601(3) if v =~ %r{\A(\d{2})/(\d{2})/(\d{4})\z}
  Time.iso8601(v).utc.iso8601(3)
end

NORMALIZERS = {
  "get_order" => ->(r) { { source: "order", id: r["order_id"], date: to_iso(r["created_ts"]), status: ORDER_STATUS.fetch(r["status_code"], "unknown (#{r['status_code']})") } },
  "get_shipment" => ->(r) { { source: "shipment", id: r["tracking_no"], date: to_iso(r["shipped_at"]), status: r["state"].to_s.downcase.tr("_", " ") } },
  "get_payment" => ->(r) { { source: "payment", id: r["payment_id"], date: to_iso(r["paid_on"]), status: PAYMENT_STATUS.fetch(r["st"], "unknown (#{r['st']})") } },
}.freeze

inp = hook_input
norm = NORMALIZERS[short_name(inp["tool_name"])]
raw = read_payload(inp["tool_response"])
exit 0 unless norm && raw
puts JSON.generate({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: write_payload(inp["tool_response"], norm.(raw)) } })
