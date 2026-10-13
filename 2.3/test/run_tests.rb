# frozen_string_literal: true

# Kiểm thử bài 2.3. Chạy: ruby test/run_tests.rb
# Phần config_check, load_document, payload tool_choice, audit là kiểm thử THẬT (code tất định).
# Phần end-to-end dùng StubClient (GIẢ LẬP Claude theo kịch bản).

require_relative "../multi_agent_run"
require_relative "../config_check"

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


puts "== config_check =="
ConfigCheck.checks.each { |r| check("config: #{r[:name]}", r[:ok]) }

# Cấu hình hỏng phải bị bắt: thêm search_web vào synthesis, đưa extract_metadata cho coordinator, thêm fetch_url.
bad = ToolConfig::AGENTS.transform_values(&:dup)
bad["synthesis"] = bad["synthesis"].merge(tools: bad["synthesis"][:tools] + [ToolConfig::WEB_SEARCH_TOOLS[0]])
bad["coordinator"] = bad["coordinator"].merge(tools: bad["coordinator"][:tools] + [ToolConfig::DOC_ANALYSIS_TOOLS[0]])
bad["web_search"] = bad["web_search"].merge(tools: bad["web_search"][:tools] + [ToolConfig.tool("fetch_url", "x" * 50, {}, []),
                                                                               ToolConfig.tool("extra_one", "y" * 50, {}, [])])
failed = ConfigCheck.checks(bad).reject { |r| r[:ok] }.map { |r| r[:name] }
check("config hỏng: bắt tool trùng role", failed.any? { |n| n.include?("trùng") })
check("config hỏng: bắt fetch_url", failed.any? { |n| n.include?("fetch_url") })
check("config hỏng: bắt coordinator giữ tool nghiệp vụ", failed.any? { |n| n.include?("coordinator") })
check("config hỏng: bắt web_search 6 tool", failed.any? { |n| n.start_with?("web_search: 4–5") })

puts "\n== load_document =="
{
  "https://www.gso.gov.vn/bao-cao-lao-dong-2026.pdf" => nil,
  "https://www.ilo.org/hybrid-work-asia-2025.pdf" => nil,
  "https://hbr.org/2026/03/hybrid.html" => nil,
  "https://docs.example.vn/docs/chinh-sach-hybrid-v2.md" => nil,
  "http://www.gso.gov.vn/bao-cao.pdf" => "validation",
  "https://www.gso.gov.vn/images/chart.png" => "validation",
  "https://www.gso.gov.vn/api/stats.json" => "validation",
  "https://www.gso.gov.vn/api/stats" => "validation",
  "https://localhost/report.pdf" => "permission",
  "https://169.254.169.254/latest/meta-data/iam.txt" => "permission",
  "https://10.0.0.5/secret.pdf" => "permission",
  "https://evil.example.com/report.pdf" => "permission",
  "https://gso.gov.vn.evil.com/report.pdf" => "permission",
  "không phải url" => "validation"
}.each do |url, want|
  e = LoadDocument.validate(url)
  got = e && e[:structuredContent][:errorCategory]
  ok = got == want && (e.nil? || (e[:isError] == true && e[:structuredContent][:isRetryable] == false &&
                                  e[:structuredContent][:description].size > 20))
  check("load_document #{url} → #{want || 'hợp lệ'}", ok)
end

puts "\n== payload tool_choice =="
p1 = build_payload("doc_analysis", 1, [])
p2 = build_payload("doc_analysis", 2, [])
check("doc_analysis lượt 1: tool_choice {type: tool, name: extract_metadata}", p1[:tool_choice] == { type: "tool", name: "extract_metadata" })
check("doc_analysis lượt 2: tool_choice auto", p2[:tool_choice] == { type: "auto" })
check("synthesis: tool_choice any", build_payload("synthesis", 3, [])[:tool_choice] == { type: "any" })
check("web_search: tool_choice auto", build_payload("web_search", 1, [])[:tool_choice] == { type: "auto" })
check("payload chỉ gửi đúng bộ tool của agent", p1[:tools].map { |t| t[:name] } == ToolConfig.allowed_names("doc_analysis"))
thinking = { type: "enabled", budget_tokens: 2048 }
raised = begin; build_payload("doc_analysis", 1, [], thinking: thinking); false; rescue ArgumentError; true; end
check("forced + extended thinking bị từ chối", raised)
raised = begin; build_payload("synthesis", 1, [], thinking: thinking); false; rescue ArgumentError; true; end
check("any + extended thinking bị từ chối", raised)
check("auto + extended thinking được phép", build_payload("doc_analysis", 2, [], thinking: thinking)[:thinking] == thinking)

puts "\n== verify_fact (scoped) =="
w = MockWorld.new
w.execute("save_snippet", { "url" => StubClient::GSO, "quote" => "62% doanh nghiệp văn phòng áp dụng hybrid", "location" => "tr. 14" })
r, err = w.execute("verify_fact", { "fact" => "62% doanh nghiệp áp dụng hybrid", "source_url" => StubClient::GSO })
check("dữ kiện đơn 1 nguồn → verified", !err && r[:verified] == true && r[:location] == "tr. 14")
r, err = w.execute("verify_fact", { "fact" => StubClient::COMPLEX, "source_url" => StubClient::ILO })
check("nhận định so sánh → lỗi business, chuyển coordinator", err && r[:errorCategory] == "business" && r[:description].include?("coordinator"))

puts "\n== audit =="
runner = Runner.new(StubClient.new)
content, is_err = runner.dispatch("synthesis", "synthesis#1", ToolConfig.allowed_names("synthesis"),
                                  { "name" => "search_web", "input" => { "query" => "x" } })
check("tool ngoài bộ → is_error permission", is_err && content[:errorCategory] == "permission")
check("tool ngoài bộ → ghi vi phạm, không thực thi", runner.violations.size == 1 && runner.world.snippets.empty?)

puts "\n== end-to-end (STUB) =="
runner = Runner.new(StubClient.new)
final = runner.run
checks, used = verify_log(runner)
checks.each { |c| check("e2e: #{c[:name]}", c[:ok]) }
check("e2e: web_search bị load_document từ chối ảnh .png",
      runner.log.any? { |e| e[:type] == "tool_error" && e[:tool] == "load_document" && e[:error][:errorCategory] == "validation" })
check("e2e: coordinator chỉ dùng Agent/review_output", (used["coordinator"].uniq - %w[Agent review_output request_revision]).empty?)
check("e2e: câu trả lời cuối có nguồn và giới hạn số liệu", final.include?("GSO") && final.include?("tự đánh giá"))

puts "\n== misuse demo (STUB) =="
runner = Runner.new(StubClient.new(misuse_demo: true))
runner.run
checks, = verify_log(runner)
check("misuse: audit ghi đúng 1 vi phạm synthesis→search_web",
      runner.violations.map { |v| "#{v[:agent]}→#{v[:tool]}" } == ["synthesis→search_web"])
check("misuse: kiểm tra 'không vi phạm' báo FAIL", checks.find { |c| c[:name] == "không có vi phạm audit" }[:ok] == false)
check("misuse: synthesis vẫn hoàn tất compile_report sau khi bị chặn",
      runner.log.any? { |e| e[:agent] == "synthesis" && e[:tool_calls]&.include?("compile_report") })

puts "\n#{$pass} PASS, #{$fail} FAIL"
exit($fail.zero? ? 0 : 1)
