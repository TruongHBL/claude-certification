#!/usr/bin/env ruby
# frozen_string_literal: true

# Test bản CLI bài 1.2 bằng `claude` GIẢ (test/bin/claude). Không gọi model.
#   ruby test/run_tests.rb

require "json"
require "open3"
require "tmpdir"
require "fileutils"

ROOT = File.expand_path("..", __dir__)
BIN = File.join(__dir__, "bin")
$pass = 0
$fail = 0
def check(name, ok)
  puts "#{ok ? 'PASS' : 'FAIL'}  #{name}"
  ok ? $pass += 1 : $fail += 1
end

# ---- 1. agents.json ----
agents = JSON.parse(File.read(File.join(ROOT, "agents.json")))
check "agents.json: đủ search/analysis/synthesis", agents.keys.sort == %w[analysis-agent search-agent synthesis-agent]
check "agents.json: search-agent chỉ có tool search", agents.dig("search-agent", "tools") == ["mcp__research__search"]
check "agents.json: analysis/synthesis cấm Agent, Task và search",
      %w[analysis-agent synthesis-agent].all? { (%w[Agent Task mcp__research__search] - agents.dig(_1, "disallowedTools")).empty? }
check "agents.json: mọi agent có description + prompt", agents.values.all? { _1["description"].to_s.size > 20 && _1["prompt"].to_s.size > 20 }

# ---- 2. MCP server ----
Dir.mktmpdir do |d|
  log = File.join(d, "t.log")
  reqs = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search", arguments: { query: "wind power" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search", arguments: { query: " " } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "fetch", arguments: {} } },
    { jsonrpc: "2.0", id: 6, method: "x/y" }
  ].map { JSON.generate(_1) }.join("\n")
  out, = Open3.capture2({ "RESEARCH_LOG" => log }, "ruby", File.join(ROOT, "research_mcp_server.rb"), stdin_data: reqs)
  res = out.lines.map { JSON.parse(_1) }.to_h { [_1["id"], _1] }
  check "server: tools/list = [search]", res.dig(2, "result", "tools").map { _1["name"] } == ["search"]
  check "server: search trả 3 kết quả có URL", res.dig(3, "result", "content", 0, "text").scan("https://example.com/wind-power").size == 3
  check "server: query rỗng → isError", res.dig(4, "result", "isError") == true
  check "server: tool lạ → isError", res.dig(5, "result", "isError") == true
  check "server: method lạ → -32601", res.dig(6, "error", "code") == -32_601
  check "server: ghi log 3 lần", File.readlines(log).size == 3
end

# ---- 3. Đầu-cuối ----
def run_cli(extra_env = {})
  env = { "PATH" => "#{BIN}:#{ENV['PATH']}" }.merge(extra_env)
  out, st = Open3.capture2e(env, File.join(ROOT, "run_cli.sh"))
  [out, st, out[/Lưu tại: (\S+)/, 1]]
end

Dir.mktmpdir do |d|
  argv_log = File.join(d, "argv.log")
  out, st, run_dir = run_cli("FAKE_ARGV_LOG" => argv_log)
  argv = JSON.parse(File.readlines(argv_log).last)
  check "e2e: --agents trỏ tới agents.json", argv[argv.index("--agents") + 1].end_with?("agents.json")
  check "e2e: --tools Agent (chỉ giữ Agent trong bộ built-in)", argv[argv.index("--tools") + 1] == "Agent"
  check "e2e: --allowedTools Agent + search", argv.each_cons(3).any? { _1 == ["--allowedTools", "Agent", "mcp__research__search"] }
  check "e2e: --system-prompt là coordinator prompt", argv[argv.index("--system-prompt") + 1].include?("coordinator (hub)")
  check "e2e: model haiku, stream-json, budget, strict-mcp",
        argv[argv.index("--model") + 1] == "haiku" && argv.include?("stream-json") && argv.include?("--max-budget-usd") && argv.include?("--strict-mcp-config")
  check "e2e: kịch bản đúng → 8/8 PASS, exit 0", st.success? && out.scan(/^PASS/).size == 8
  check "e2e: liệt kê 11 lần spawn trong 3 lượt", out.include?("11 lần spawn, 3 lượt")
  check "e2e: lượt 1 là 5 subagent SONG SONG", out.include?("· 5 subagent SONG SONG")
  check "e2e: server ghi 5 search, khớp stream", out.include?("ghi nhận 5 lần search · stream-json có 5 tool_use search")
  FileUtils.rm_rf(run_dir)

  out, st, run_dir = run_cli("FAKE_MISUSE" => "nested")
  check "misuse nested: báo FAIL 'Subagent không spawn…' + chỉ ra analysis-agent",
        !st.success? && out.include?("FAIL  Subagent không spawn") && out.include?("vi phạm: analysis-agent gọi search-agent")
  FileUtils.rm_rf(run_dir)

  out, st, run_dir = run_cli("FAKE_MISUSE" => "search")
  check "misuse search: báo FAIL 'search chỉ chạy trong search-agent'",
        !st.success? && out.include?("FAIL  search chỉ chạy trong search-agent") && out.include?("vi phạm: analysis-agent tự gọi search")
  FileUtils.rm_rf(run_dir)
end
cr = File.join(ROOT, "cli_runs")
Dir.rmdir(cr) if Dir.exist?(cr) && Dir.empty?(cr)

puts "\n#{$pass} PASS, #{$fail} FAIL"
exit($fail.zero? ? 0 : 1)
