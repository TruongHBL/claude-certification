#!/usr/bin/env ruby
# frozen_string_literal: true

# Bài 2.3 – bản CLI: hook PreToolUse (matcher "*") thay cho tool_choice + audit của bản Messages API.
#
# Input (JSON trên stdin, theo BaseHookInput của Agent SDK 0.3.x):
#   tool_name, tool_input, session_id, agent_id (CHỈ có khi tool được gọi trong subagent),
#   agent_type (tên agent: có trong subagent, hoặc ở luồng chính khi chạy --agent coordinator).
#
# Hai luật:
#   1. Allowlist theo vai trò: tool ngoài bộ của agent → deny + ghi vi phạm.
#      (Lớp thứ 2: lớp thứ 1 là agents.tools. Hook bắt được khi agents.tools bị cấu hình nhầm.)
#   2. Cổng doc-analysis: chưa gọi extract_metadata trong subagent này → deny mọi tool khác của nó.
#      GẦN ĐÚNG với tool_choice forced: hook chỉ CHẶN lệnh sai rồi trả lý do, KHÔNG ÉP model gọi
#      extract_metadata. Model phải tự gọi lại; lượt đầu có thể là một lệnh bị chặn.
#
# Output: deny → JSON hookSpecificOutput.permissionDecision = "deny" (exit 0).
#         cho phép → không in gì (để luật quyền thường của phiên quyết định).
# Env: GUARD_LOG (JSONL), GUARD_STATE (thư mục lưu trạng thái cổng theo agent_id).

require "json"
require "fileutils"
require_relative "../tool_config"

SERVER_PREFIX = "mcp__research__"
CLI_TO_ROLE = { "coordinator" => "coordinator", "web-search" => "web_search",
                "doc-analysis" => "doc_analysis", "synthesis" => "synthesis" }.freeze

def now = Time.now.utc.strftime("%Y-%m-%dT%H:%M:%S.%LZ")

def append_jsonl(path, entry)
  return unless path

  FileUtils.mkdir_p(File.dirname(path))
  File.open(path, "a") do |f|
    f.flock(File::LOCK_EX)
    f.puts(JSON.generate(entry))
  end
end

def deny(reason)
  puts JSON.generate(hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
                                           permissionDecisionReason: reason })
end

# Trả [role, cli_agent_name]. Luồng chính không có agent_id; với --agent coordinator thì agent_type = coordinator.
def resolve_agent(input)
  type = input["agent_type"]
  return ["coordinator", type || "(main)"] if input["agent_id"].to_s.empty? && (type.nil? || type == "coordinator")

  [CLI_TO_ROLE[type], type]
end

# Cổng extract_metadata: trạng thái theo từng subagent (agent_id). Dự phòng khi thiếu agent_id: session + agent_type.
def gate_key(input) = (input["agent_id"].to_s.empty? ? "#{input['session_id']}-#{input['agent_type']}" : input["agent_id"]).gsub(/[^\w.-]/, "_")

def gate_passed?(dir, key) = dir && File.exist?(File.join(dir, "#{key}.metadata_done"))

def mark_gate(dir, key)
  return unless dir

  FileUtils.mkdir_p(dir)
  File.write(File.join(dir, "#{key}.metadata_done"), now)
end

input = JSON.parse($stdin.read)
tool_name = input["tool_name"].to_s
tool = tool_name.delete_prefix(SERVER_PREFIX)
role, cli_agent = resolve_agent(input)
log = ENV["GUARD_LOG"]
state = ENV["GUARD_STATE"]
entry = { ts: now, session_id: input["session_id"], agent_id: input["agent_id"], agent_type: input["agent_type"],
          agent: cli_agent, role: role, tool: tool, tool_input: input["tool_input"] }

decision, rule, reason = nil
if role.nil?
  decision, rule = "deny", "unknown_agent"
  reason = "Agent '#{cli_agent}' không có trong cấu hình bài 2.3; không cấp tool nào."
elsif !ToolConfig.allowed_names(role).include?(tool)
  decision, rule = "deny", "outside_allowlist"
  reason = "Tool '#{tool}' không thuộc bộ tool của #{cli_agent} (#{ToolConfig.allowed_names(role).join(', ')}). " \
           "Không thử lại; ghi việc này vào kết quả để coordinator giao đúng agent."
elsif role == "doc_analysis"
  key = gate_key(input)
  if tool == "extract_metadata"
    mark_gate(state, key)
  elsif !gate_passed?(state, key)
    decision, rule = "deny", "metadata_gate"
    reason = "Bước bắt buộc đầu tiên: gọi extract_metadata cho tài liệu trước khi #{tool}."
  end
end

append_jsonl(log, entry.merge(decision: decision || "pass", rule: rule, reason: reason))
deny(reason) if decision == "deny"
exit 0
