#!/usr/bin/env ruby
# frozen_string_literal: true

# Bài 1.2 – bản CLI: MCP server "research" (stdio, JSON-RPC 2.0, Ruby thuần, không cần gem).
#
# Một tool `search` GIẢ LẬP thay cho server tool web_search của bản API (tránh phí tìm kiếm và để
# kết quả lặp lại được). Mỗi kết quả có nguồn, để kiểm tra coordinator có chuyển nguồn sang
# subagent phân tích không.
# RESEARCH_LOG=<file> : mỗi tools/call ghi 1 dòng JSON.

require "json"
require "time"

LOG_FILE = ENV["RESEARCH_LOG"]

TOOLS = [
  { name: "search",
    description: "Tìm thông tin về MỘT nhánh con của chủ đề nghiên cứu. Trả về 3 kết quả ngắn, mỗi kết quả kèm URL nguồn. " \
                 "Chỉ dành cho subagent tìm kiếm.",
    inputSchema: { type: "object",
                   properties: { query: { type: "string", description: "Câu truy vấn, vd 'solar photovoltaic 2026'" } },
                   required: ["query"] } }
].freeze

def slug(s) = s.downcase.gsub(/[^a-z0-9]+/, "-").gsub(/\A-|-\z/, "")[0, 40]

def fake_search(query)
  s = slug(query).then { _1.empty? ? "topic" : _1 }
  "[MOCK] 3 kết quả cho '#{query}':\n" \
    "- Tổng quan về #{query} (nguồn: https://example.com/#{s}/overview)\n" \
    "- Số liệu gần đây về #{query} (nguồn: https://example.com/#{s}/stats)\n" \
    "- Thách thức và triển vọng của #{query} (nguồn: https://example.com/#{s}/outlook)"
end

def call_tool(name, args)
  if LOG_FILE
    File.open(LOG_FILE, "a") { |f| f.puts JSON.generate({ at: Time.now.iso8601, tool: name, arguments: args }) }
  end
  return { content: [{ type: "text", text: "Tool không tồn tại: #{name}" }], isError: true } unless name == "search"

  q = args["query"].to_s.strip
  return { content: [{ type: "text", text: "Lỗi: query rỗng" }], isError: true } if q.empty?

  { content: [{ type: "text", text: fake_search(q) }] }
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
                  capabilities: { tools: {} }, serverInfo: { name: "research", version: "1.0.0" } })
  when "notifications/initialized", "notifications/cancelled" then nil
  when "ping" then respond(id, {})
  when "tools/list" then respond(id, { tools: TOOLS })
  when "tools/call"
    respond(id, call_tool(msg.dig("params", "name"), msg.dig("params", "arguments") || {}))
  else
    respond_error(id, -32_601, "Method not found: #{msg['method']}") unless id.nil?
  end
end
