#!/usr/bin/env ruby
# frozen_string_literal: true
# PostToolUse(mcp__ops__aml_check): ghi state "AML pass" theo session_id + customer_id (để pre_aml_gate đọc).
require_relative "lib"

inp = hook_input
r = read_payload(inp["tool_response"])
append_jsonl("aml_pass.jsonl", { session_id: inp["session_id"], customer_id: r["customer_id"] }) if r && r["aml"] == "pass"
