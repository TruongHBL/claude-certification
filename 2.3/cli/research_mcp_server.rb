#!/usr/bin/env ruby
# frozen_string_literal: true

# Bài 2.3 – bản CLI: MCP server stdio "research" phục vụ 12 tool nghiệp vụ + 2 tool điều phối.
#
# Định nghĩa tool lấy từ ../tool_config.rb, dữ liệu giả + logic tool lấy từ MockWorld trong
# ../multi_agent_run.rb (file đó có main guard nên require không chạy gì).
# Một tiến trình server phục vụ cả coordinator lẫn mọi subagent của cùng một lệnh `claude -p`
# (subagent dùng chung MCP server của phiên cha) → kho trích đoạn save_snippet dùng chung được.
#
# Server KHÔNG biết agent nào gọi; việc gán agent và kiểm allowlist do hook guard_hook.rb làm.
#
# Env: RESEARCH_LOG = file JSONL ghi mỗi tools/call (tool, args, isError) – audit_cli.rb đọc.

require "json"
require_relative "../tool_config"
require_relative "../multi_agent_run"

SERVER_NAME = "research"
LOG_PATH = ENV["RESEARCH_LOG"]

# Tool "Agent" là built-in của Claude Code, không phục vụ qua MCP.
TOOLS = ToolConfig::AGENTS.values.flat_map { |a| a[:tools] }
                          .reject { |t| t[:name] == "Agent" }
                          .uniq { |t| t[:name] }
                          .map { |t| { name: t[:name], description: t[:description], inputSchema: t[:input_schema] } }
                          .freeze
TOOL_NAMES = TOOLS.map { |t| t[:name] }.freeze

WORLD = MockWorld.new

def log_call(entry)
  return unless LOG_PATH

  File.open(LOG_PATH, "a") do |f|
    f.flock(File::LOCK_EX)
    f.puts(JSON.generate(entry.merge(ts: Time.now.utc.strftime("%Y-%m-%dT%H:%M:%S.%LZ"))))
  end
end

def call_tool(name, args)
  data, is_err = WORLD.execute(name, args)
  log_call(tool: name, args: args, isError: is_err)
  result = { content: [{ type: "text", text: JSON.generate(data) }] }
  result[:structuredContent] = data if data.is_a?(Hash)
  result[:isError] = true if is_err
  result
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
                  serverInfo: { name: SERVER_NAME, version: "1.0.0" } })
  when "notifications/initialized", "notifications/cancelled"
    nil
  when "ping"
    respond(id, {})
  when "tools/list"
    respond(id, { tools: TOOLS })
  when "tools/call"
    name = msg.dig("params", "name")
    # Tool không tồn tại = lỗi giao thức (lớp 1, bài 2.2), không phải lỗi thực thi.
    if TOOL_NAMES.include?(name)
      respond(id, call_tool(name, msg.dig("params", "arguments") || {}))
    else
      respond_error(id, -32_602, "Unknown tool: #{name}")
    end
  else
    respond_error(id, -32_601, "Method not found: #{msg['method']}") unless id.nil?
  end
end
