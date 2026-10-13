#!/usr/bin/env ruby
# frozen_string_literal: true

# Test bản CLI bài 1.1 bằng `claude` GIẢ (test/bin/claude). Không gọi model.
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

# ---- 1. MCP server qua stdin ----
Dir.mktmpdir do |d|
  log = File.join(d, "t.log")
  reqs = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "web_search", arguments: { query: "dân số Hà Nội" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "calculator", arguments: { expression: "(9.5 - 8.7) / 8.7 * 100" } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "calculator", arguments: { expression: "1/0" } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "calculator", arguments: { expression: "2 ^ 3" } } },
    { jsonrpc: "2.0", id: 7, method: "foo/bar" }
  ].map { JSON.generate(_1) }.join("\n")
  out, = Open3.capture2({ "LOOP_LOG" => log }, "ruby", File.join(ROOT, "loop_mcp_server.rb"), stdin_data: reqs)
  res = out.lines.map { JSON.parse(_1) }.to_h { [_1["id"], _1] }
  check "server: initialize trả serverInfo loop", res.dig(1, "result", "serverInfo", "name") == "loop"
  check "server: tools/list có web_search + calculator",
        res.dig(2, "result", "tools").map { _1["name"] } == %w[web_search calculator]
  check "server: web_search trả số liệu giả lập", res.dig(3, "result", "content", 0, "text").include?("8,7 triệu")
  check "server: calculator tính đúng 9.1954", res.dig(4, "result", "content", 0, "text") == "9.1954"
  check "server: chia 0 → isError", res.dig(5, "result", "isError") == true
  check "server: ký tự lạ → isError", res.dig(6, "result", "isError") == true
  check "server: method lạ → -32601", res.dig(7, "error", "code") == -32_601
  check "server: ghi log 4 lần tools/call", File.readlines(log).size == 4
end

# ---- 2. Đầu-cuối: run_cli.sh + claude giả + parse_loop.rb ----
def run_cli(extra_env = {})
  env = { "PATH" => "#{BIN}:#{ENV['PATH']}" }.merge(extra_env)
  out, st = Open3.capture2e(env, File.join(ROOT, "run_cli.sh"))
  run_dir = out[/Lưu tại: (\S+)/, 1]
  [out, st, run_dir]
end

Dir.mktmpdir do |d|
  argv_log = File.join(d, "argv.log")
  out, st, run_dir = run_cli("FAKE_ARGV_LOG" => argv_log)
  argv = JSON.parse(File.readlines(argv_log).last)
  check "e2e: lệnh claude có -p, stream-json, --verbose", argv.include?("-p") && argv.include?("stream-json") && argv.include?("--verbose")
  check "e2e: --tools \"\" (tắt tool built-in)", argv[argv.index("--tools") + 1] == ""
  check "e2e: --allowedTools đúng 2 tool MCP",
        argv.each_cons(3).any? { _1 == ["--allowedTools", "mcp__loop__web_search", "mcp__loop__calculator"] }
  check "e2e: --strict-mcp-config + --max-budget-usd + --model haiku",
        argv.include?("--strict-mcp-config") && argv.include?("--max-budget-usd") && argv[argv.index("--model") + 1] == "haiku"
  check "e2e: không dùng --bare / --safe-mode", !argv.include?("--bare") && !argv.include?("--safe-mode")
  check "e2e: exit 0, 4 PASS của parser", st.success? && out.scan(/^PASS/).size == 4
  check "e2e: gom 2 dòng cùng message.id thành 1 lượt → 3 lượt", out.include?("Số lượt API (gom theo message.id): 3")
  check "e2e: 4 tool_use, ghép đủ 4/4 tool_result", out.include?("tool_result ghép được: 4/4")
  check "e2e: server ghi 4 lần, khớp số tool_use", out.include?("4 lần tools/call (khớp số tool_use)")
  check "e2e: kết quả calculator thật từ server (9.1954)", out.include?("9.1954")
  check "e2e: lưu report.txt", File.exist?(File.join(run_dir, "report.txt"))
  FileUtils.rm_rf(run_dir)

  out, _, run_dir = run_cli("FAKE_NO_STOP_REASON" => "1")
  check "thiếu stop_reason → suy ra và đánh dấu (suy ra)", out.include?("stop_reason=tool_use (suy ra)") && out.include?("end_turn (suy ra)")
  FileUtils.rm_rf(run_dir)

  out, st, run_dir = run_cli("FAKE_DROP_RESULT" => "1")
  check "thiếu tool_result → parser báo FAIL, exit≠0", out.include?("FAIL  Mọi tool_use đều có tool_result") && !st.success?
  FileUtils.rm_rf(run_dir)
end
Dir.rmdir(File.join(ROOT, "cli_runs")) if Dir.exist?(File.join(ROOT, "cli_runs")) && Dir.empty?(File.join(ROOT, "cli_runs"))

puts "\n#{$pass} PASS, #{$fail} FAIL"
exit($fail.zero? ? 0 : 1)
