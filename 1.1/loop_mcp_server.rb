#!/usr/bin/env ruby
# frozen_string_literal: true

# Bài 1.1 – bản CLI: MCP server "loop" (stdio, JSON-RPC 2.0, Ruby thuần, không cần gem).
#
# Hai tool GIỐNG HỆT bản API (bai_1_1_agentic_loop.rb): web_search (dữ liệu giả lập) và calculator.
# Ở bản API, chính code của mình chạy tool trong vòng lặp. Ở bản CLI, Claude Code chạy vòng lặp
# và gọi sang server này qua MCP; server chỉ thực thi tool.
# LOOP_LOG=<file> : mỗi tools/call ghi 1 dòng JSON (tool, arguments, kết quả, isError).

require "json"
require "time"

LOG_FILE = ENV["LOOP_LOG"]

TOOLS = [
  { name: "web_search",
    description: "Tìm số liệu thực tế (dân số, diện tích...) về một chủ đề. " \
                 "Dùng khi cần dữ kiện chưa có trong hội thoại. Trả về một đoạn văn ngắn có số liệu.",
    inputSchema: { type: "object",
                   properties: { query: { type: "string", description: "Câu truy vấn, ví dụ 'dân số Hà Nội 2024'" } },
                   required: ["query"] } },
  { name: "calculator",
    description: "Tính biểu thức số học gồm + - * / và dấu ngoặc. Dùng cho MỌI phép tính thay vì tự tính nhẩm.",
    inputSchema: { type: "object",
                   properties: { expression: { type: "string",
                                               description: "Biểu thức, ví dụ '(9.5 - 8.7) / 8.7 * 100'" } },
                   required: ["expression"] } }
].freeze

# Dữ liệu GIẢ LẬP (không phải số liệu chính thức), cùng bộ với bản API.
MOCK_FACTS = {
  "hà nội" => "Dân số Hà Nội năm 2024 khoảng 8,7 triệu người (số liệu giả lập).",
  "hồ chí minh" => "Dân số TP. Hồ Chí Minh năm 2024 khoảng 9,5 triệu người (số liệu giả lập).",
  "hcm" => "Dân số TP. Hồ Chí Minh năm 2024 khoảng 9,5 triệu người (số liệu giả lập)."
}.freeze

def web_search(query)
  q = query.downcase
  hit = MOCK_FACTS.find { |k, _| q.include?(k) }
  hit ? hit[1] : "Không tìm thấy kết quả cho '#{query}'."
end

# Parser đệ quy cho + - * / ( ), không dùng eval (chép từ bản API).
class Calc
  def self.evaluate(str) = new(str).parse

  def initialize(str)
    @tokens = str.scan(%r{\d+(?:[.,]\d+)?|[-+*/()]}).map { |t| t.tr(",", ".") }
    rest = str.gsub(%r{\d+(?:[.,]\d+)?|[-+*/()]|\s}, "")
    raise ArgumentError, "ký tự không hợp lệ: #{rest}" unless rest.empty?
  end

  def parse
    v = expr
    raise ArgumentError, "thừa token: #{@tokens.join}" unless @tokens.empty?
    v
  end

  private

  def expr
    v = term
    while %w[+ -].include?(@tokens.first)
      @tokens.shift == "+" ? v += term : v -= term
    end
    v
  end

  def term
    v = factor
    while %w[* /].include?(@tokens.first)
      if @tokens.shift == "*"
        v *= factor
      else
        d = factor
        raise ZeroDivisionError, "chia cho 0" if d.zero?
        v /= d
      end
    end
    v
  end

  def factor
    t = @tokens.shift or raise ArgumentError, "biểu thức chưa đầy đủ"
    case t
    when "(" then v = expr; @tokens.shift == ")" ? v : raise(ArgumentError, "thiếu ')'")
    when "-" then -factor
    when "+" then factor
    else Float(t)
    end
  end
end

def call_tool(name, args)
  out, err =
    begin
      case name
      when "web_search" then [web_search(args["query"].to_s), false]
      when "calculator" then [Calc.evaluate(args["expression"].to_s).round(4).to_s, false]
      else ["Tool không tồn tại: #{name}", true]
      end
    rescue ArgumentError, ZeroDivisionError => e
      ["Lỗi: #{e.message}", true] # lỗi thực thi → isError để Claude tự sửa input
    end
  if LOG_FILE
    File.open(LOG_FILE, "a") do |f|
      f.puts JSON.generate({ at: Time.now.iso8601, tool: name, arguments: args, output: out, isError: err })
    end
  end
  r = { content: [{ type: "text", text: out }] }
  r[:isError] = true if err
  r
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
                  capabilities: { tools: {} }, serverInfo: { name: "loop", version: "1.0.0" } })
  when "notifications/initialized", "notifications/cancelled" then nil
  when "ping" then respond(id, {})
  when "tools/list" then respond(id, { tools: TOOLS })
  when "tools/call"
    respond(id, call_tool(msg.dig("params", "name"), msg.dig("params", "arguments") || {}))
  else
    respond_error(id, -32_601, "Method not found: #{msg['method']}") unless id.nil?
  end
end
