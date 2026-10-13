#!/usr/bin/env ruby
# frozen_string_literal: true
# Test bài 1.3 bản không cần API key. KHÔNG gọi model.
#   THẬT : Agent SDK thật spawn binary, giao thức stream-json, hàm verify() của bài, script run_cli.sh.
#   GIẢ  : luồng coordinator/subagent trong test/bin/claude-sdk-fake là kịch bản cố định.
# Chạy: SDK_NODE_MODULES=<node_modules có @anthropic-ai/claude-agent-sdk> ruby test/run_tests.rb
require "json"
require "open3"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)
$pass = $fail = 0
def check(name, cond, extra = "")
  cond ? $pass += 1 : $fail += 1
  puts "#{cond ? 'PASS' : 'FAIL'}  #{name}#{extra.empty? ? '' : "  → #{extra}"}"
end

nm = ENV["SDK_NODE_MODULES"]
abort "Cần SDK_NODE_MODULES trỏ tới node_modules có @anthropic-ai/claude-agent-sdk" unless nm && File.directory?(File.join(nm, "@anthropic-ai", "claude-agent-sdk"))
link = File.join(ROOT, "node_modules")
tmp = Dir.mktmpdir("t13")
log = File.join(tmp, "sdk.log")

begin
  puts "== Đầu-cuối run_cli.sh (Agent SDK THẬT → claude-sdk-fake)"
  env = { "CLAUDE_BIN" => File.join(ROOT, "test", "bin", "claude-sdk-fake"), "SDK_NODE_MODULES" => nm,
          "FAKE_SDK_LOG" => log, "ANTHROPIC_API_KEY" => "sk-dummy-phai-bi-unset" }
  o, st = Open3.capture2e(env, File.join(ROOT, "run_cli.sh"))
  check("run_cli.sh chạy xong, exit 0", st.success?, st.success? ? "" : o[-400..])
  rows = File.readlines(log).map { JSON.parse(_1) }
  argv = rows.find { _1["argv"] }&.fetch("argv") || []
  check("SDK spawn đúng binary trỏ bởi CLAUDE_BIN", rows.any? { _1["self"].to_s.end_with?("claude-sdk-fake") })
  check("tiến trình con KHÔNG có ANTHROPIC_API_KEY (run_cli.sh đã unset)", rows.select { _1.key?("has_api_key") }.none? { _1["has_api_key"] })
  allowed = argv[argv.index("--allowedTools").to_i + 1].to_s.split(",")
  check("--allowedTools có Agent (thiếu là không spawn được subagent)", allowed.include?("Agent"), allowed.join(","))
  check("outputFormat json_schema → cờ --json-schema", argv.include?("--json-schema"))
  check("--max-budget-usd 2 được truyền xuống CLI", argv[argv.index("--max-budget-usd").to_i + 1] == "2")
  check("SDK gửi đủ 3 AgentDefinition trong initialize", rows.any? { _1.dig("initialize", "agents")&.sort == %w[doc-analyst synthesizer web-researcher] })
  check("verify(): phát hiện spawn song song từ stream thật của SDK", o.include?("Spawn song song 2 subagent nghiên cứu: CÓ"))
  check("verify(): synthesizer nhận findings đủ metadata", o.include?("Findings gửi tới synthesizer: 2") && o.include?("Lỗi metadata: không"))
  check("verify(): không có claim mồ côi", o.include?("Claim mồ côi: không"))

  puts "\n== Test hàm thuần có sẵn (bai_1_3_test_stub.ts)"
  o, st = Open3.capture2e("node", "--experimental-strip-types", "--no-warnings", File.join(ROOT, "bai_1_3_test_stub.ts"))
  check("bai_1_3_test_stub.ts", st.success?, o.lines.last.to_s.strip)
ensure
  File.unlink(link) if File.symlink?(link)
end

puts "\n#{$pass} PASS, #{$fail} FAIL"
exit($fail.zero? ? 0 : 1)
