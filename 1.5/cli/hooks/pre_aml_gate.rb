#!/usr/bin/env ruby
# frozen_string_literal: true
# PreToolUse(mcp__ops__transfer_funds): chỉ cho chuyển tiền khi phiên này đã có aml_check PASS cho đúng khách.
require_relative "lib"

inp = hook_input
cus = inp.dig("tool_input", "customer_id")
file = File.join(STATE_DIR, "aml_pass.jsonl")
passed = File.exist?(file) && File.foreach(file).any? { |l| r = JSON.parse(l); r["session_id"] == inp["session_id"] && r["customer_id"] == cus }
deny!("Chưa có aml_check PASS cho khách #{cus} trong phiên này. Gọi aml_check trước; nếu AML fail thì không được chuyển tiền.") unless passed
