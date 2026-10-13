# frozen_string_literal: true

# Test bản CLI bài 1.4.
#  Phần 1 (THẬT, không cần model): bơm JSON-RPC vào support_mcp_server.rb, kiểm cổng chặn + handoff validator.
#  Phần 2 (GIẢ): run_cli.sh all với `claude` giả (test/bin/claude) → kiểm đường chạy end-to-end + bộ chấm.
# Chạy: ruby test/run_cli_tests.rb

require "json"
require "open3"
require "tmpdir"
require "fileutils"

ROOT = File.expand_path("..", __dir__)
$pass = 0
$fail = 0
def check(name, ok)
  ok ? $pass += 1 : $fail += 1
  puts "#{ok ? 'PASS' : 'FAIL'}  #{name}"
end

# Mỗi phiên = 1 server process + 1 file state.
def session(dir)
  env = { "STATE_FILE" => File.join(dir, "state.json"), "SUPPORT_LOG" => File.join(dir, "tools.log") }
  Open3.popen2(env, "ruby", File.join(ROOT, "support_mcp_server.rb")) do |sin, sout, _|
    id = 0
    rpc = lambda do |method, params = {}|
      sin.puts JSON.generate({ jsonrpc: "2.0", id: id += 1, method: method, params: params })
      JSON.parse(sout.gets)
    end
    call = ->(name, a) { rpc.("tools/call", { name: name, arguments: a })["result"] }
    yield rpc, call
  end
  JSON.parse(File.read(File.join(dir, "state.json")))
end

REFUND = { "customer_id" => "C-001", "order_id" => "ORD-1001", "amount" => 120, "reason" => "hỏng" }.freeze
GOOD = { "email" => "an@example.com", "phone_last4" => "6789" }.freeze

puts "— Phần 1: server thật qua JSON-RPC"
Dir.mktmpdir do |d|
  st = session(d) do |rpc, call|
    check "initialize trả serverInfo support", rpc.("initialize")["result"]["serverInfo"]["name"] == "support"
    check "tools/list có đủ 4 tool", rpc.("tools/list")["result"]["tools"].map { _1["name"] }.sort ==
                                     %w[escalate_to_human get_customer lookup_order process_refund]
    r = call.("process_refund", REFUND)
    check "refund khi chưa xác minh → isError + BLOCKED", r["isError"] == true && r["content"][0]["text"].start_with?("BLOCKED")
    r = call.("get_customer", GOOD.merge("phone_last4" => "1111"))
    check "sai 4 số cuối → verified false", JSON.parse(r["content"][0]["text"])["verified"] == false
    r = call.("process_refund", REFUND)
    check "xác minh thất bại thì refund vẫn bị chặn", r["isError"] == true
    call.("get_customer", GOOD)
    r = call.("process_refund", REFUND.merge("customer_id" => "C-002", "order_id" => "ORD-2001"))
    check "refund cho khách khác khách đã xác minh → chặn", r["isError"] == true && r["content"][0]["text"].include?("khác khách")
    r = call.("process_refund", REFUND.merge("amount" => 999))
    check "số tiền vượt giá trị đơn → lỗi", r["isError"] == true
    r = call.("process_refund", REFUND)
    check "sau khi xác minh đúng → refund thành công", r["isError"].nil? && JSON.parse(r["content"][0]["text"])["status"] == "refunded"
    r = call.("escalate_to_human", { "customer_id" => "C-001", "conversation_summary" => "x", "root_cause_analysis" => "TBD",
                                    "refund_amount" => 0, "recommended_action" => "N/A", "concerns" => [] })
    check "handoff có placeholder/rỗng → bị từ chối, nêu đủ trường",
          r["isError"] == true && %w[root_cause_analysis recommended_action concerns].all? { r["content"][0]["text"].include?(_1) }
    r = call.("escalate_to_human", { "customer_id" => "C-001", "conversation_summary" => "Khách hỏi trừ tiền 2 lần",
                                    "root_cause_analysis" => "Cổng thanh toán trừ trùng", "refund_amount" => 0,
                                    "recommended_action" => "Đối soát giao dịch",
                                    "concerns" => [{ "type" => "billing_dispute", "detail" => "trừ 2 lần", "status" => "needs_human" }] })
    check "handoff đủ 5 trường → escalated", JSON.parse(r["content"][0]["text"])["status"] == "escalated"
    check "tool lạ → isError", call.("delete_everything", {})["isError"] == true
    check "method lạ → JSON-RPC -32601", rpc.("foo/bar").dig("error", "code") == -32_601
  end
  check "ledger chỉ có đúng 1 refund (các lệnh bị chặn không có side effect)", st["ledger"].size == 1
  log = File.readlines(File.join(d, "tools.log")).map { JSON.parse(_1) }
  check "log server ghi mọi lần gọi, đánh dấu blocked", log.size == 10 && log.count { _1["blocked"] } == 3
end

Dir.mktmpdir do |d|
  session(d) { |_, call| call.("get_customer", GOOD) }
  st = session(d) { |_, call| call.("process_refund", REFUND) }
  check "state theo file: xác minh ở lần chạy server trước vẫn giữ trong cùng phiên", st["ledger"].size == 1
end

puts "— Phần 2: end-to-end với claude GIẢ"
Dir.mktmpdir do |d|
  results = File.join(ROOT, "results_cli")
  backup = File.exist?(results) ? File.join(d, "bak") : nil
  FileUtils.mv(results, backup) if backup
  argv_log = File.join(d, "argv.log")
  env = { "CLAUDE_BIN" => File.join(ROOT, "test/bin/claude"), "FAKE_ARGV_LOG" => argv_log }
  out, status = Open3.capture2e(env, File.join(ROOT, "run_cli.sh"), "all")
  puts out.lines.map { "   | #{_1}" }.join
  check "run_cli.sh all + score_cli.rb: mọi kiểm tra đạt", status.success? && out.include?("Tất cả kiểm tra đạt.")
  check "kịch bản skip: bộ chấm thấy 1 lần bị cổng chặn", out[/== skip\n.*?lần bị cổng chặn: (\d+)/m, 1] == "1"
  check "kịch bản multi: bộ chấm thấy 1 handoff bị từ chối", out[/== multi\n.*?handoff bị từ chối: (\d+)/m, 1] == "1"
  argv = File.readlines(argv_log).map { JSON.parse(_1) }
  first = argv.first
  check "gọi claude 4 lần (4 kịch bản)", argv.size == 4
  check "cờ CLI đúng: -p, --tools \"\", --strict-mcp-config, --permission-mode dontAsk, stream-json",
        first.include?("-p") && first[first.index("--tools") + 1] == "" && first.include?("--strict-mcp-config") &&
        first[first.index("--permission-mode") + 1] == "dontAsk" && first[first.index("--output-format") + 1] == "stream-json"
  check "allowedTools đúng 4 tool mcp__support__*",
        first.count { _1.start_with?("mcp__support__") } == 4
  # Bộ chấm phải bắt được khi cổng chặn bị vượt: sửa log giả để refund thành công trước xác minh.
  wp = File.join(results, "wrongphone")
  File.write(File.join(wp, "tools.log"),
             JSON.generate({ tool: "process_refund", arguments: REFUND, isError: false, blocked: false, result: {} }) + "\n")
  File.write(File.join(wp, "state.json"), JSON.generate({ ledger: [{ order_id: "ORD-1001" }], handoffs: [] }))
  out2, st2 = Open3.capture2e("ruby", File.join(ROOT, "score_cli.rb"), results, File.join(ROOT, "scenarios.json"), "wrongphone")
  check "bộ chấm báo FAIL khi refund xảy ra trước xác minh", !st2.success? && out2.include?("FAIL  Cổng chặn giữ")
  FileUtils.rm_rf(results)
  FileUtils.mv(backup, results) if backup
end

puts "\n#{$pass} PASS, #{$fail} FAIL"
exit($fail.zero? ? 0 : 1)
