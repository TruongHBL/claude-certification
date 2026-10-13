# frozen_string_literal: true

# Bài 2.2 – kiểm thử server (bơm JSON-RPC qua stdin) và vòng hồi phục. Không gọi model.
# Chạy: ruby test/run_tests.rb

require "json"
require "open3"
ENV["BACKOFF_SCALE"] = "0.01"
require_relative "../recovery_agent"

$pass = 0
$fail = 0
def check(name, cond)
  if cond
    $pass += 1
    puts "PASS  #{name}"
  else
    $fail += 1
    puts "FAIL  #{name}"
  end
end

def rpc_session(lines, env = {})
  input = lines.map { |l| JSON.generate(l) }.join("\n") + "\n"
  out, = Open3.capture2(env, RbConfig.ruby, SERVER, stdin_data: input)
  out.lines.map { |l| JSON.parse(l) }
end

def call(id, name, args) = { jsonrpc: "2.0", id: id, method: "tools/call", params: { name: name, arguments: args } }

# ---- Server ----
init = { jsonrpc: "2.0", id: 0, method: "initialize", params: {} }
r = rpc_session([init, { jsonrpc: "2.0", method: "notifications/initialized" },
                 { jsonrpc: "2.0", id: 1, method: "tools/list" },
                 call(2, "get_customer", { "customer_id" => "CUS-0012", "simulate" => "timeout" }),
                 call(3, "get_customer", { "customer_id" => "cus-12" }),
                 call(4, "process_refund", { "customer_id" => "CUS-0012", "amount" => 750 }),
                 call(5, "get_customer", { "customer_id" => "CUS-0777" }),
                 call(6, "get_customer", { "customer_id" => "CUS-9999" }),
                 call(7, "get_custmer", {}),
                 call(8, "process_refund", { "customer_id" => "CUS-0012" }),
                 { jsonrpc: "2.0", id: 9, method: "foo/bar" }])
by_id = r.to_h { |m| [m["id"], m] }
check("notification không được trả lời (11 message, 10 có id → 10 response)", r.size == 10)
check("tools/list có 2 tool", by_id[1].dig("result", "tools").map { |t| t["name"] } == %w[get_customer process_refund])
check("customer_id không khai báo pattern trong schema",
      by_id[1].dig("result", "tools", 0, "inputSchema", "properties", "customer_id", "pattern").nil?)
{ 2 => ["transient", true], 3 => ["validation", false], 4 => ["business", false], 5 => ["permission", false] }.each do |id, (cat, retry_)|
  sc = by_id[id].dig("result", "structuredContent")
  check("#{cat}: isError=true, đúng 3 field, isRetryable=#{retry_}",
        by_id[id].dig("result", "isError") == true && sc.keys.sort == %w[description errorCategory isRetryable] &&
        sc["errorCategory"] == cat && sc["isRetryable"] == retry_ && sc["description"].length > 40)
end
empty = by_id[6]["result"]
check("rỗng hợp lệ: isError=false, resultCount=0, không có errorCategory",
      empty["isError"] == false && empty.dig("structuredContent", "resultCount").zero? &&
      !empty["structuredContent"].key?("errorCategory"))
check("rỗng hợp lệ ≠ access failure (khác isError và khác key)",
      empty["isError"] != by_id[2].dig("result", "isError") &&
      (empty["structuredContent"].keys & by_id[2].dig("result", "structuredContent").keys).empty?)
check("tool không tồn tại → JSON-RPC error -32602, không có result", by_id[7].dig("error", "code") == -32_602 && !by_id[7].key?("result"))
check("thiếu tham số bắt buộc → JSON-RPC error", by_id[8].dig("error", "message").include?("missing amount"))
check("method lạ → -32601", by_id[9].dig("error", "code") == -32_601)

r = rpc_session([init] + (1..3).map { |i| call(i, "get_customer", { "customer_id" => "CUS-0042", "simulate" => "flaky:2" }) })
check("flaky:2: lần 1,2 transient, lần 3 thành công",
      r[1]["result"]["isError"] && r[2]["result"]["isError"] && r[3]["result"]["isError"] == false)

bad = rpc_session([init, call(1, "get_customer", { "customer_id" => "CUS-9999" }),
                   call(2, "process_refund", { "customer_id" => "CUS-0012", "amount" => 750 })], { "ERROR_STYLE" => "bad" })
check("ERROR_STYLE=bad: rỗng và business đều chỉ là \"Error\", không metadata",
      bad[1..].all? { |m| m.dig("result", "isError") && m.dig("result", "content", 0, "text") == "Error" && !m["result"].key?("structuredContent") })

# ---- Agent structured ----
S = SCENARIOS.to_h { |s| [s[:id], s] }
res = SCENARIOS.to_h { |s| [s[:id], run_scenario("structured", s)] }
SCENARIOS.each do |s|
  check("structured ##{s[:id]} #{s[:name]}: #{s[:expect]} sau #{s[:expect_calls]} lần gọi",
        res[s[:id]][:outcome] == s[:expect] && res[s[:id]][:calls] == s[:expect_calls])
end
check("business / permission / rỗng: gọi đúng 1 lần, không retry", [2, 7, 8].all? { |i| res[i][:calls] == 1 && res[i][:delays].empty? })
check("timeout: dừng sau 3 retry (1 + 3 = 4 lần gọi)", res[4][:calls] == 4 && res[4][:delays].size == 3)
d = res[4][:delays]
check("backoff tăng dần ×2 (0.2 → 0.4 → 0.8, đã scale)", d.each_cons(2).all? { |a, b| (b / a - 2).abs < 1e-9 })
check("flaky:2 thành công ở lần gọi thứ 3 với 2 delay", res[3][:calls] == 3 && res[3][:delays].size == 2)
check("validation sửa được: lần 2 dùng CUS-0012", res[5][:log].any? { |l| l.include?("'cus 12' → 'CUS-0012'") })
check("handoff business có mã khách, số tiền, lý do",
      res[7][:handoff][:customer_id] == "CUS-0012" && res[7][:handoff][:amount_usd] == 750 && res[7][:handoff][:reason].include?("500"))
check("fix_customer_id", fix_customer_id("cus-0012") == "CUS-0012" && fix_customer_id("CUS12") == "CUS-0012" &&
      fix_customer_id("order-abc").nil?)

batch = run_batch("structured")[:report]
check("lan truyền: báo cáo có kết quả 1 phần + khách lỗi + khách rỗng tách riêng",
      batch[:found] == ["CUS-0012"] && batch[:not_found] == ["CUS-9999"] && batch[:failed].map { |f| f[:customer_id] } == ["CUS-0042"])

# ---- Agent với lỗi kiểu cũ ----
badres = SCENARIOS.to_h { |s| [s[:id], run_scenario("bad", s)] }
check("bad: rỗng hợp lệ bị retry vô ích rồi escalate (4 lần)", badres[2][:outcome] == :escalated && badres[2][:calls] == 4)
check("bad: business bị retry (4 lần gọi hoàn tiền)", badres[7][:calls] == 4)
check("bad: validation sửa được nhưng không sửa (escalate)", badres[5][:outcome] == :escalated)
check("bad: tổng số lần gọi nhiều hơn structured",
      badres.values.sum { |r| r[:calls] } > res.values.sum { |r| r[:calls] })
bb = run_batch("bad")[:report]
check("bad: lan truyền lẫn khách không tồn tại vào nhóm lỗi", bb[:not_found].empty? && bb[:failed].size == 2)

puts "\n#{$pass} PASS, #{$fail} FAIL"
exit($fail.zero? ? 0 : 1)
