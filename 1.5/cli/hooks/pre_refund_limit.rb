#!/usr/bin/env ruby
# frozen_string_literal: true
# PreToolUse(mcp__ops__process_refund): refund > $500 (hoặc số tiền không hợp lệ) → deny + ghi hàng đợi người duyệt.
require_relative "lib"

inp = hook_input
amount = Float(inp.dig("tool_input", "amount_usd"), exception: false)
unless amount && amount <= REFUND_LIMIT_USD
  reason = "Refund $#{inp.dig('tool_input', 'amount_usd')} vượt hạn mức $#{REFUND_LIMIT_USD}. Không tự xử lý; " \
           "đã chuyển cho nhân viên duyệt (escalation). Hãy báo khách là yêu cầu đang chờ duyệt."
  append_jsonl("escalations.jsonl", { session_id: inp["session_id"], tool: inp["tool_name"], input: inp["tool_input"], reason: reason })
  deny!(reason)
end
