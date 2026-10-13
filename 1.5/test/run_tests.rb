#!/usr/bin/env ruby
# frozen_string_literal: true
# Test bài 1.5 bản không cần API key. KHÔNG gọi model.
#   THẬT : shell hook (bơm JSON qua stdin đúng như Claude Code), MCP server (bơm JSON-RPC), script chạy.
#   GIẢ  : "model" chọn tool trong test/bin/claude và test/bin/claude-sdk-fake là kịch bản cố định.
# Chạy: ruby test/run_tests.rb     (SDK_NODE_MODULES=<node_modules có claude-agent-sdk> để chạy thêm phần SDK)
require "json"
require "open3"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)
HOOKS = File.join(ROOT, "cli", "hooks")
$pass = $fail = 0
def check(name, cond, extra = "")
  cond ? $pass += 1 : $fail += 1
  puts "#{cond ? 'PASS' : 'FAIL'}  #{name}#{extra.empty? ? '' : "  → #{extra}"}"
end

STATE = Dir.mktmpdir("hook15")
def hook(script, input)
  o, e, st = Open3.capture3({ "HOOK_STATE_DIR" => STATE }, "ruby", File.join(HOOKS, script), stdin_data: JSON.generate(input))
  [st.exitstatus, (JSON.parse(o) rescue nil), e]
end
def pre(tool, args, sid = "s1") = { session_id: sid, hook_event_name: "PreToolUse", tool_name: "mcp__ops__#{tool}", tool_input: args, tool_use_id: "t" }
def post(tool, resp, sid = "s1") = { session_id: sid, hook_event_name: "PostToolUse", tool_name: "mcp__ops__#{tool}", tool_input: {}, tool_response: resp, tool_use_id: "t" }
def decision(j) = j&.dig("hookSpecificOutput", "permissionDecision")

puts "== Hook (THẬT, bơm JSON stdin)"
st, j, = hook("pre_refund_limit.rb", pre("process_refund", { order_id: "ORD-1", amount_usd: 750 }))
check("refund 750 → deny (exit 0 + JSON)", st == 0 && decision(j) == "deny", j.to_s[0, 90])
st, j, = hook("pre_refund_limit.rb", pre("process_refund", { order_id: "ORD-1", amount_usd: 500 }))
check("refund 500 (đúng hạn mức) → không chặn", st == 0 && j.nil?)
st, j, = hook("pre_refund_limit.rb", pre("process_refund", { order_id: "ORD-1", amount_usd: "abc" }))
check("refund số tiền không hợp lệ → deny", decision(j) == "deny")
esc = File.readlines(File.join(STATE, "escalations.jsonl")).size
check("mỗi lần deny refund ghi 1 escalation", esc == 2, "#{esc} dòng")

_, j, = hook("pre_aml_gate.rb", pre("transfer_funds", { customer_id: "CUS-42", amount_usd: 200 }))
check("transfer khi chưa AML → deny", decision(j) == "deny")
hook("post_aml_record.rb", post("aml_check", [{ type: "text", text: '{"customer_id":"CUS-42","aml":"pass"}' }]))
_, j, = hook("pre_aml_gate.rb", pre("transfer_funds", { customer_id: "CUS-42", amount_usd: 200 }))
check("AML pass rồi → transfer được", j.nil?)
_, j, = hook("pre_aml_gate.rb", pre("transfer_funds", { customer_id: "CUS-42", amount_usd: 200 }, "s2"))
check("AML pass ở phiên khác KHÔNG có hiệu lực (khoá theo session_id)", decision(j) == "deny")
_, j, = hook("pre_aml_gate.rb", pre("transfer_funds", { customer_id: "CUS-99", amount_usd: 1 }))
check("AML pass của khách khác KHÔNG có hiệu lực", decision(j) == "deny")
hook("post_aml_record.rb", post("aml_check", [{ type: "text", text: '{"customer_id":"BLOCKED-1","aml":"fail"}' }]))
_, j, = hook("pre_aml_gate.rb", pre("transfer_funds", { customer_id: "BLOCKED-1", amount_usd: 1 }))
check("AML fail → vẫn chặn", decision(j) == "deny")

order = '{"order_id":"ORD-1001","created_ts":1790845200,"status_code":2}'
want = { "source" => "order", "id" => "ORD-1001", "date" => "2026-10-01T09:00:00.000Z", "status" => "shipped" }
[["mảng content block", [{ "type" => "text", "text" => order }]], ["{content: [...]}", { "content" => [{ "type" => "text", "text" => order }] }], ["chuỗi", order]].each do |label, resp|
  _, j, = hook("post_normalize.rb", post("get_order", resp))
  u = j&.dig("hookSpecificOutput", "updatedToolOutput")
  txt = u.is_a?(String) ? u : (u.is_a?(Array) ? u : u&.dig("content")).to_a.dig(0, "text")
  check("normalize get_order, tool_response dạng #{label}, giữ nguyên hình dạng", JSON.parse(txt.to_s) == want && u.class == resp.class) rescue check("normalize #{label}", false)
end
_, j, = hook("post_normalize.rb", post("get_shipment", [{ type: "text", text: '{"tracking_no":"SHP-1","shipped_at":"2026-10-03T09:30:00+09:00","state":"IN_TRANSIT"}' }]))
s = JSON.parse(j.dig("hookSpecificOutput", "updatedToolOutput", 0, "text"))
check("normalize get_shipment: +09:00 → UTC, IN_TRANSIT → in transit", s["date"] == "2026-10-03T00:30:00.000Z" && s["status"] == "in transit")
_, j, = hook("post_normalize.rb", post("get_payment", [{ type: "text", text: '{"payment_id":"PAY-1","paid_on":"02/10/2026","st":"P"}' }]))
s = JSON.parse(j.dig("hookSpecificOutput", "updatedToolOutput", 0, "text"))
check("normalize get_payment: DD/MM/YYYY → ISO, P → paid", s["date"] == "2026-10-02T00:00:00.000Z" && s["status"] == "paid")
st, j, = hook("post_normalize.rb", post("aml_check", [{ type: "text", text: "{}" }]))
check("normalize bỏ qua tool không phải get_*", st == 0 && j.nil?)

puts "\n== MCP server (THẬT, bơm JSON-RPC)"
ledger = File.join(STATE, "ledger.txt")
reqs = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "process_refund", arguments: { order_id: "ORD-9", amount_usd: 10 } } },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } },
].map { JSON.generate(_1) }.join("\n") + "\n"
o, = Open3.capture2({ "LEDGER_FILE" => ledger }, "ruby", File.join(ROOT, "cli", "ops_mcp_server.rb"), stdin_data: reqs)
res = o.lines.map { JSON.parse(_1) }
check("server trả 4 phản hồi (notification không có phản hồi)", res.size == 4)
check("tools/list có đủ 6 tool", res[1].dig("result", "tools").map { _1["name"] }.sort == %w[aml_check get_order get_payment get_shipment process_refund transfer_funds])
check("tool tiền tệ ghi LEDGER khi thực sự chạy", File.read(ledger).include?("refund ORD-9 $10"))
check("tool lạ → JSON-RPC error (lỗi giao thức)", res[3].dig("error", "code") == -32602)

puts "\n== Đầu-cuối run_cli_hooks.sh với claude GIẢ (hook + server THẬT, chọn tool GIẢ)"
env = { "PATH" => "#{ROOT}/test/bin:#{ENV['PATH']}", "ANTHROPIC_API_KEY" => "sk-dummy-phai-bi-unset", "FAKE_ARGV_LOG" => File.join(STATE, "argv.log") }
o, st = Open3.capture2e(env, File.join(ROOT, "run_cli_hooks.sh"))
check("run_cli_hooks.sh chạy xong", st.success?, st.success? ? "" : o[-300..])
led = File.read(File.join(ROOT, "cli", "state", "ledger.txt")) rescue ""
check("LEDGER chỉ có 1 giao dịch hợp lệ (refund 750 không chạy)", led.lines.map(&:strip) == ["transfer CUS-42 $200"], led.inspect)
check("output ra model đã chuẩn hoá (date ISO, status chữ)", o.include?('"status":"shipped"') && o.include?('"status":"paid"'))
argv = File.readlines(File.join(STATE, "argv.log")).map { JSON.parse(_1) }
check("mỗi prompt một lệnh claude -p riêng", argv.count { _1.include?("-p") } == 3)
a = argv.find { _1.include?("-p") } || []
check("cờ đúng: --settings, --strict-mcp-config, --tools \"\", --permission-mode dontAsk",
      a.include?("--settings") && a.include?("--strict-mcp-config") && a[a.index("--tools").to_i + 1] == "" && a[a.index("--permission-mode").to_i + 1] == "dontAsk")
system(File.join(ROOT, "run_cli_hooks.sh"), "clean", out: File::NULL)

puts "\n== Đầu-cuối run_cli.sh (Agent SDK THẬT → claude-sdk-fake nói giao thức stream-json)"
nm = ENV["SDK_NODE_MODULES"]
if nm && File.directory?(File.join(nm, "@anthropic-ai", "claude-agent-sdk"))
  log = File.join(STATE, "sdk.log")
  env = { "CLAUDE_BIN" => File.join(ROOT, "test", "bin", "claude-sdk-fake"), "SDK_NODE_MODULES" => nm,
          "FAKE_SDK_LOG" => log, "ANTHROPIC_API_KEY" => "sk-dummy-phai-bi-unset" }
  o, st = Open3.capture2e(env, File.join(ROOT, "run_cli.sh"))
  check("run_cli.sh chạy xong qua SDK", st.success?, st.success? ? "" : o[-400..])
  rows = File.readlines(log).map { JSON.parse(_1) }
  check("SDK spawn đúng binary trỏ bởi CLAUDE_BIN", rows.any? { _1["self"].to_s.end_with?("claude-sdk-fake") })
  check("tiến trình con KHÔNG có ANTHROPIC_API_KEY", rows.select { _1.key?("has_api_key") }.none? { _1["has_api_key"] })
  check("SDK đăng ký 4 hook callback + SDK MCP server ops", rows.any? { _1.dig("initialize", "sdkMcpServers") == ["ops"] && _1.dig("initialize", "hooks", "PreToolUse").size == 2 })
  check("refund 750 bị hook TS chặn, không thực thi", rows.any? { _1["tool"] == "process_refund" && _1["executed"] == false })
  check("LEDGER trong tiến trình Node chỉ có transfer hợp lệ", o.include?("LEDGER: [ 'transfer CUS-42 $200' ]"), o.lines.grep(/LEDGER/).join.strip)
  File.unlink(File.join(ROOT, "node_modules")) if File.symlink?(File.join(ROOT, "node_modules"))
else
  puts "BỎ QUA (không có SDK_NODE_MODULES)"
end

puts "\n#{$pass} PASS, #{$fail} FAIL"
exit($fail.zero? ? 0 : 1)
