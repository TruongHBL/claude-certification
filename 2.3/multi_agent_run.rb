# frozen_string_literal: true

# Bài 2.3 – Build Exercise: chạy end-to-end hệ coordinator + 3 subagent với tool phân theo vai trò.
#
# Dùng Claude Messages API trực tiếp (Net::HTTP, không cần gem) vì tool_choice là tham số của
# Messages API và cần đổi theo TỪNG LƯỢT (doc_analysis: lượt 1 ép extract_metadata, sau đó auto).
# Agent SDK / Claude Code không cho đặt tool_choice từng lượt như vậy.
#
# Mỗi agent là một vòng lặp agent riêng (bài 1.1): stop_reason "tool_use" → chạy tool → lặp;
# "end_turn" → xong. Riêng synthesis dùng tool_choice "any" nên không bao giờ end_turn: phiên kết thúc
# khi gọi terminal tool compile_report.
#
# Lớp audit: MỌI tool_use đều được đối chiếu với allowlist của agent đang chạy. Tool ngoài bộ
# → ghi vi phạm, trả tool_result is_error, KHÔNG thực thi.
#
# Chạy:  ruby multi_agent_run.rb                 # client GIẢ LẬP (stub), mặc định
#        ruby multi_agent_run.rb --misuse-demo   # stub: synthesis cố gọi search_web → audit chặn
#        ANTHROPIC_API_KEY=... ruby multi_agent_run.rb --real   # Claude thật (CHƯA chạy)

require "json"
require "net/http"
require "uri"
require "fileutils"
require_relative "tool_config"
require_relative "load_document"

MODEL = ENV.fetch("MODEL", "claude-haiku-5-5")
MAX_TURNS = 10 # lưới an toàn, không phải điều kiện dừng chính
QUESTION = "Làm việc hybrid ảnh hưởng thế nào tới năng suất nhân viên văn phòng ở Việt Nam năm 2026? " \
           "Cần số liệu có nguồn."

SYSTEM_PROMPTS = {
  "coordinator" => "Bạn là coordinator của hệ nghiên cứu. Chia việc cho subagent bằng tool Agent " \
                   "(web_search tìm nguồn → doc_analysis phân tích → synthesis viết báo cáo). " \
                   "Truyền đủ context trong prompt giao việc. Nhận định synthesis đưa vào " \
                   "needs_coordinator_verification là kiểm chứng phức tạp: giao doc_analysis dùng verify_claim. " \
                   "Duyệt bằng review_output rồi trả lời người dùng.",
  "web_search" => "Bạn là agent tìm nguồn. Chỉ dùng tool của mình. Lưu mọi trích đoạn bằng save_snippet. " \
                  "Kết thúc bằng tóm tắt các nguồn kèm document_id và url.",
  "doc_analysis" => "Bạn là agent phân tích tài liệu. Luôn lấy metadata trước, rồi số liệu, tóm tắt. " \
                    "Kết thúc bằng các phát hiện kèm nguồn.",
  "synthesis" => "Bạn là agent tổng hợp. Tra dữ kiện đơn giản một nguồn bằng verify_fact; nhận định phức tạp " \
                 "đưa vào needs_coordinator_verification. Kết thúc bằng compile_report."
}.freeze

# ---------------------------------------------------------------------------
# Thế giới giả lập: kết quả tìm kiếm, tài liệu, kho trích đoạn (tool chạy local, dữ liệu mock)
# ---------------------------------------------------------------------------
class MockWorld
  DOCS = {
    "https://www.gso.gov.vn/bao-cao-lao-dong-2026.pdf" => {
      id: "doc-gso", title: "Báo cáo điều tra lao động việc làm 2026", author: "Tổng cục Thống kê (GSO)",
      date: "2026-07-15", type: "báo cáo thống kê",
      data: [{ value: "62%", what: "doanh nghiệp văn phòng áp dụng hybrid", location: "tr. 14" },
             { value: "2,4 ngày/tuần", what: "số ngày làm tại nhà trung bình", location: "tr. 15" }],
      summary: ["Hybrid phổ biến ở doanh nghiệp văn phòng", "Nhóm 25–35 tuổi chọn hybrid nhiều nhất",
                "Báo cáo không đo trực tiếp năng suất"]
    },
    "https://www.ilo.org/hybrid-work-asia-2025.pdf" => {
      id: "doc-ilo", title: "Hybrid Work in Asia-Pacific 2025", author: "ILO", date: "2025-11-02",
      type: "báo cáo nghiên cứu",
      data: [{ value: "4–7%", what: "năng suất tự đánh giá tăng với hybrid 2–3 ngày", location: "p. 31" },
             { value: "n = 3.200", what: "mẫu khảo sát 6 nước, có Việt Nam", location: "p. 8" }],
      summary: ["Hybrid 2–3 ngày/tuần gắn với năng suất tự đánh giá cao hơn", "Toàn thời gian tại nhà không tốt hơn",
                "Số liệu tự đánh giá, không phải đo lường khách quan"]
    }
  }.freeze

  attr_reader :snippets

  def initialize
    @snippets = []
    @loaded = {}
  end

  def doc_by_id(id) = DOCS.values.find { |d| d[:id] == id }

  def ok(data) = [data, false]
  def err(h) = [h[:structuredContent], true]

  def execute(name, input)
    case name
    when "search_web"
      ok(results: DOCS.map { |url, d| { title: d[:title], url: url, snippet: d[:summary].first } } +
                  [{ title: "Biểu đồ hybrid 2026", url: "https://www.gso.gov.vn/images/hybrid-chart.png", snippet: "ảnh" }])
    when "load_document"
      if (e = LoadDocument.validate(input["url"])) then return err(e) end
      d = DOCS[input["url"]] or
        return [{ errorCategory: "validation", isRetryable: false, description: "Không có tài liệu tại URL này." }, true]
      @loaded[d[:id]] = true
      ok(document_id: d[:id], title: d[:title], chars: 18_000)
    when "extract_links" then ok(links: [])
    when "save_snippet"
      @snippets << input.slice("url", "quote", "location")
      ok(saved: true, total: @snippets.size)
    when "extract_metadata"
      d = doc_by_id(input["document_id"]) or return missing_doc(input)
      ok(d.slice(:title, :author, :date, :type))
    when "extract_data_points"
      d = doc_by_id(input["document_id"]) or return missing_doc(input)
      ok(data_points: d[:data])
    when "summarize_content"
      d = doc_by_id(input["document_id"]) or return missing_doc(input)
      ok(summary: d[:summary])
    when "verify_claim"
      ok(claim: input["claim"], verdict: "một phần đúng", confidence: "trung bình",
         reasoning: "ILO đo năng suất TỰ ĐÁNH GIÁ, mẫu 6 nước; GSO không đo năng suất. " \
                    "Không đủ cơ sở khẳng định con số 4–7% cho riêng Việt Nam.",
         sources: input["document_ids"])
    when "verify_fact" then verify_fact(input)
    when "format_citation"
      ok(citation: "#{input['author']} (#{input['year']}). #{input['title']}. #{input['url']}")
    when "assess_coverage" then ok(missing: [], covered: input["draft_outline"])
    when "compile_report" then ok(accepted: true)
    when "review_output", "request_revision" then ok(recorded: true)
    else [{ errorCategory: "validation", isRetryable: false, description: "Tool không tồn tại: #{name}" }, true]
    end
  end

  # verify_fact là tool SCOPED: chỉ tra một dữ kiện đơn trong MỘT nguồn đã lưu.
  # Heuristic giả lập: nhận định có từ so sánh/nhân quả → coi là phức tạp, trả về coordinator.
  COMPLEX_MARKERS = ["so với", "dẫn đến", "làm tăng", "làm giảm", "do ", "nhờ", "vì "].freeze
  def verify_fact(input)
    fact = input["fact"].to_s
    if COMPLEX_MARKERS.any? { |m| fact.downcase.include?(m) }
      return [{ errorCategory: "business", isRetryable: false,
                description: "Ngoài phạm vi verify_fact (nhận định so sánh/nhân quả cần nhiều nguồn). " \
                             "Đưa vào needs_coordinator_verification." }, true]
    end
    hit = @snippets.find { |s| s["url"] == input["source_url"] && fact.split.any? { |w| w =~ /\d/ && s["quote"].include?(w) } }
    hit ? ok(verified: true, source_url: hit["url"], quote: hit["quote"], location: hit["location"])
        : ok(verified: false, note: "Không thấy dữ kiện trong trích đoạn đã lưu của nguồn này.")
  end

  def missing_doc(input)
    [{ errorCategory: "validation", isRetryable: false, description: "document_id '#{input['document_id']}' chưa được tải." }, true]
  end
end

# ---------------------------------------------------------------------------
# Payload: tool_choice theo lượt + ràng buộc API
# ---------------------------------------------------------------------------
def build_payload(agent, turn, messages, thinking: nil)
  cfg = ToolConfig::AGENTS.fetch(agent)
  choice = cfg[:tool_choice].call(turn)
  # Ràng buộc của Messages API: khi bật extended thinking, tool_choice chỉ được auto hoặc none.
  if thinking && %w[any tool].include?(choice[:type])
    raise ArgumentError, "tool_choice #{choice[:type]} không dùng được cùng extended thinking (chỉ auto/none)"
  end

  payload = { model: MODEL, max_tokens: 2048, system: SYSTEM_PROMPTS.fetch(agent),
              tools: cfg[:tools], tool_choice: choice, messages: messages }
  payload[:thinking] = thinking if thinking
  payload
end

# ---------------------------------------------------------------------------
# Transport thật (CHƯA chạy) và transport giả lập
# ---------------------------------------------------------------------------
class RealClient
  URL = URI("https://api.anthropic.com/v1/messages")
  def initialize(key) = @key = key

  def create(payload, agent:, session:)
    req = Net::HTTP::Post.new(URL, "content-type" => "application/json", "x-api-key" => @key,
                                   "anthropic-version" => "2023-06-01")
    req.body = JSON.generate(payload)
    res = Net::HTTP.start(URL.host, URL.port, use_ssl: true, read_timeout: 120) { |h| h.request(req) }
    raise "HTTP #{res.code}: #{res.body[0, 300]}" unless res.is_a?(Net::HTTPSuccess)
    JSON.parse(res.body)
  end
end

# GIẢ LẬP: đóng vai Claude theo kịch bản cố định. Tôn trọng tool_choice như API thật:
# forced → trả đúng tool đó; any → luôn trả tool_use; auto → có thể trả text.
# Kết quả phản ánh KỊCH BẢN, không phải hành vi của Claude.
class StubClient
  GSO = "https://www.gso.gov.vn/bao-cao-lao-dong-2026.pdf"
  ILO = "https://www.ilo.org/hybrid-work-asia-2025.pdf"
  COMPLEX = "Hybrid làm tăng năng suất 4–7% so với làm toàn thời gian tại văn phòng ở Việt Nam"

  def initialize(misuse_demo: false)
    @misuse = misuse_demo
    @seq = 0
  end

  def create(payload, agent:, session:)
    turn = payload[:messages].count { |m| m[:role] == "assistant" } + 1
    calls = script(agent, session, turn, payload)
    choice = payload[:tool_choice]
    if choice[:type] == "tool" && (calls.is_a?(String) || calls.map(&:first) != [choice[:name]])
      raise "stub sai kịch bản: lượt #{turn} của #{agent} bị ép #{choice[:name]}"
    end
    raise "stub sai kịch bản: #{agent} bị ép any nhưng trả text" if choice[:type] == "any" && calls.is_a?(String)

    if calls.is_a?(String)
      { "stop_reason" => "end_turn", "content" => [{ "type" => "text", "text" => calls }] }
    else
      { "stop_reason" => "tool_use",
        "content" => calls.map { |name, input| { "type" => "tool_use", "id" => "toolu_#{@seq += 1}", "name" => name, "input" => input } } }
    end
  end

  private

  def last_results(payload)
    m = payload[:messages].reverse.find { |x| x[:role] == "user" && x[:content].is_a?(Array) }
    m ? m[:content].map { |b| b[:content] }.join("\n") : ""
  end

  def script(agent, session, turn, payload)
    case agent
    when "coordinator" then coordinator(turn, payload)
    when "web_search"
      [[["search_web", { "query" => "năng suất làm việc hybrid Việt Nam 2026" }]],
        [["load_document", { "url" => GSO }], ["load_document", { "url" => ILO }],
         ["load_document", { "url" => "https://www.gso.gov.vn/images/hybrid-chart.png" }]],
        [["save_snippet", { "url" => GSO, "quote" => "62% doanh nghiệp văn phòng áp dụng hybrid", "location" => "tr. 14" }],
         ["save_snippet", { "url" => ILO, "quote" => "năng suất tự đánh giá tăng 4–7% với hybrid 2–3 ngày", "location" => "p. 31" }]],
        "Nguồn: doc-gso (#{GSO}), doc-ilo (#{ILO}). Bỏ ảnh hybrid-chart.png vì load_document từ chối (không phải tài liệu)."][turn - 1]
    when "doc_analysis"
      if session.include?("verify")
        [[["extract_metadata", { "document_id" => "doc-ilo" }]],
         [["verify_claim", { "claim" => COMPLEX, "document_ids" => %w[doc-gso doc-ilo] }]],
         "Kiểm chứng: một phần đúng. Con số 4–7% là năng suất tự đánh giá, mẫu 6 nước; không dùng như số đo của riêng Việt Nam."][turn - 1]
      else
        [[["extract_metadata", { "document_id" => "doc-gso" }]],
         [["extract_metadata", { "document_id" => "doc-ilo" }],
          ["extract_data_points", { "document_id" => "doc-gso", "topic" => "hybrid" }],
          ["extract_data_points", { "document_id" => "doc-ilo", "topic" => "năng suất" }]],
         [["summarize_content", { "document_id" => "doc-gso" }], ["summarize_content", { "document_id" => "doc-ilo" }]],
         "Phát hiện: GSO 62% doanh nghiệp áp dụng hybrid (tr. 14); ILO năng suất tự đánh giá +4–7% (p. 31)."][turn - 1]
      end
    when "synthesis"
      steps = [
        [["verify_fact", { "fact" => "62% doanh nghiệp văn phòng áp dụng hybrid", "source_url" => GSO }],
         ["verify_fact", { "fact" => COMPLEX, "source_url" => ILO }]],
        [["format_citation", { "author" => "Tổng cục Thống kê", "year" => "2026", "title" => "Báo cáo điều tra lao động việc làm 2026", "url" => GSO }],
         ["format_citation", { "author" => "ILO", "year" => "2025", "title" => "Hybrid Work in Asia-Pacific 2025", "url" => ILO }]],
        [["assess_coverage", { "question" => QUESTION, "draft_outline" => ["Mức độ phổ biến", "Tác động năng suất", "Giới hạn số liệu"] }]],
        [["compile_report", {
          "title" => "Làm việc hybrid và năng suất văn phòng tại Việt Nam (2026)",
          "sections" => [
            { "heading" => "Mức độ phổ biến", "body" => "62% doanh nghiệp văn phòng áp dụng hybrid.", "citations" => [GSO] },
            { "heading" => "Tác động năng suất", "body" => "Khảo sát khu vực cho thấy năng suất tự đánh giá cao hơn với hybrid 2–3 ngày.", "citations" => [ILO] }
          ],
          "needs_coordinator_verification" => [COMPLEX]
        }]]
      ]
      steps.unshift([["search_web", { "query" => "năng suất hybrid" }]]) if @misuse
      steps[turn - 1]
    end
  end

  def coordinator(turn, payload)
    prev = last_results(payload)
    [
      [["Agent", { "agent_type" => "web_search", "prompt" => "Tìm 2–3 nguồn tài liệu đáng tin về: #{QUESTION}" }]],
      [["Agent", { "agent_type" => "doc_analysis", "prompt" => "Phân tích các tài liệu sau, trích số liệu kèm vị trí.\n#{prev}" }]],
      [["Agent", { "agent_type" => "synthesis", "prompt" => "Viết báo cáo trả lời: #{QUESTION}\nPhát hiện:\n#{prev}" }]],
      [["Agent", { "agent_type" => "doc_analysis", "prompt" => "Kiểm chứng đầy đủ nhận định: #{COMPLEX}. Tài liệu: doc-gso, doc-ilo." }]],
      [["review_output", { "agent_type" => "synthesis", "verdict" => "pass", "reason" => "Đủ nguồn; nhận định phức tạp đã kiểm chứng và ghi giới hạn." }]],
      "Báo cáo hoàn tất: 62% doanh nghiệp áp dụng hybrid (GSO 2026). Con số năng suất +4–7% là tự đánh giá, mẫu khu vực (ILO 2025), không phải số đo riêng của Việt Nam."
    ][turn - 1]
  end
end

# ---------------------------------------------------------------------------
# Runner: vòng lặp agent + audit allowlist + log JSONL
# ---------------------------------------------------------------------------
class Runner
  attr_reader :log, :violations, :world

  def initialize(client, log_path: nil)
    @client = client
    @world = MockWorld.new
    @log = []
    @violations = []
    @sessions = Hash.new(0)
    @log_path = log_path
  end

  def record(entry)
    @log << entry
    File.open(@log_path, "a") { |f| f.puts(JSON.generate(entry)) } if @log_path
  end

  # Trả [kết quả text hoặc input của terminal tool, session_id]
  def run_agent(agent, prompt, session_tag: nil)
    session = "#{agent}##{@sessions[agent] += 1}#{session_tag ? "-#{session_tag}" : ''}"
    cfg = ToolConfig::AGENTS.fetch(agent)
    allowed = ToolConfig.allowed_names(agent)
    messages = [{ role: "user", content: prompt }]

    (1..MAX_TURNS).each do |turn|
      payload = build_payload(agent, turn, messages)
      resp = @client.create(payload, agent: agent, session: session)
      uses = resp["content"].select { |b| b["type"] == "tool_use" }
      record(agent: agent, session: session, turn: turn, tool_choice: payload[:tool_choice],
             tools_offered: allowed, stop_reason: resp["stop_reason"], tool_calls: uses.map { |u| u["name"] })
      messages << { role: "assistant", content: resp["content"] }

      if resp["stop_reason"] != "tool_use"
        return [resp["content"].select { |b| b["type"] == "text" }.map { |b| b["text"] }.join, session]
      end

      terminal_input = nil
      results = uses.map do |u|
        content, is_err = dispatch(agent, session, allowed, u)
        if is_err && allowed.include?(u["name"])
          record(type: "tool_error", agent: agent, session: session, tool: u["name"], error: content)
        end
        terminal_input = u["input"] if u["name"] == cfg[:terminal_tool] && !is_err
        { type: "tool_result", tool_use_id: u["id"], content: JSON.generate(content), is_error: is_err }
      end
      messages << { role: "user", content: results }
      return [terminal_input, session] if terminal_input
    end
    raise "#{session} vượt #{MAX_TURNS} lượt"
  end

  def dispatch(agent, session, allowed, use)
    name = use["name"]
    unless allowed.include?(name)
      @violations << { agent: agent, session: session, tool: name }
      record(type: "violation", agent: agent, session: session, tool: name)
      return [{ errorCategory: "permission", isRetryable: false,
                description: "Tool '#{name}' không thuộc bộ tool của #{agent}. Dùng tool của bạn hoặc trả việc về coordinator." }, true]
    end
    if name == "Agent"
      sub = use["input"]["agent_type"]
      tag = use["input"]["prompt"].start_with?("Kiểm chứng") ? "verify" : nil
      out, _sid = run_agent(sub, use["input"]["prompt"], session_tag: tag)
      return [out.is_a?(String) ? { result: out } : { report: out }, false]
    end
    @world.execute(name, use["input"])
  end

  def run(question = QUESTION)
    final, = run_agent("coordinator", question)
    final
  end
end

# ---------------------------------------------------------------------------
# Báo cáo kiểm tra từ log
# ---------------------------------------------------------------------------
def verify_log(runner)
  calls = runner.log.reject { |e| e[:type] }
  checks = []
  add = ->(name, ok, detail = "") { checks << { name: name, ok: ok, detail: detail } }

  used = Hash.new { |h, k| h[k] = [] }
  calls.each { |e| used[e[:agent]].concat(e[:tool_calls]) }
  outside = used.flat_map { |a, names| (names.uniq - ToolConfig.allowed_names(a)).map { |n| "#{a}→#{n}" } }
  add.("mỗi agent chỉ dùng tool trong bộ của mình", outside.empty?, outside.empty? ? "OK" : outside.join(", "))

  doc_sessions = calls.select { |e| e[:agent] == "doc_analysis" }.group_by { |e| e[:session] }
  first_ok = doc_sessions.all? do |_s, es|
    f = es.min_by { |e| e[:turn] }
    f[:tool_choice] == { type: "tool", name: "extract_metadata" } && f[:tool_calls] == ["extract_metadata"] &&
      es.reject { |e| e[:turn] == 1 }.all? { |e| e[:tool_choice] == { type: "auto" } }
  end
  add.("doc_analysis: lượt 1 forced extract_metadata, các lượt sau auto (#{doc_sessions.size} phiên)", first_ok)

  syn = used["synthesis"]
  add.("synthesis dùng compile_report + verify_fact", syn.include?("compile_report") && syn.include?("verify_fact"),
       syn.tally.map { |k, v| "#{k}×#{v}" }.join(", "))
  add.("synthesis luôn chạy với tool_choice any",
       calls.select { |e| e[:agent] == "synthesis" }.all? { |e| e[:tool_choice] == { type: "any" } })

  routed = doc_sessions.keys.any? { |s| s.end_with?("-verify") } && used["doc_analysis"].include?("verify_claim")
  add.("nhận định phức tạp được chuyển coordinator → doc_analysis verify_claim", routed)
  add.("không có vi phạm audit", runner.violations.empty?, "#{runner.violations.size} vi phạm")
  [checks, used]
end

if $PROGRAM_NAME == __FILE__
  real = ARGV.include?("--real")
  client = if real
             RealClient.new(ENV.fetch("ANTHROPIC_API_KEY") { abort "Thiếu ANTHROPIC_API_KEY" })
           else
             StubClient.new(misuse_demo: ARGV.include?("--misuse-demo"))
           end
  FileUtils.mkdir_p(File.join(__dir__, "logs"))
  log_path = File.join(__dir__, "logs", "#{real ? 'real' : 'stub'}#{ARGV.include?('--misuse-demo') ? '-misuse' : ''}.jsonl")
  File.delete(log_path) if File.exist?(log_path)

  puts real ? "== Chạy với Claude thật (#{MODEL}) ==" : "== Chạy với client GIẢ LẬP (kịch bản cố định, không phải Claude) =="
  runner = Runner.new(client, log_path: log_path)
  final = runner.run
  puts "\n-- Log từng lượt --"
  runner.log.each do |e|
    if e[:type] == "tool_error"
      puts "     ↳ #{e[:tool]} trả lỗi #{e[:error][:errorCategory]}: #{e[:error][:description]}"
    elsif e[:type] == "violation"
      puts "  !! VI PHẠM  #{e[:session]} gọi #{e[:tool]} (không thuộc bộ) → trả is_error, không thực thi"
    else
      tc = e[:tool_choice][:type] == "tool" ? "tool:#{e[:tool_choice][:name]}" : e[:tool_choice][:type]
      puts format("  %-22s lượt %d  tool_choice=%-22s %s", e[:session], e[:turn], tc,
                  e[:tool_calls].empty? ? "(end_turn)" : e[:tool_calls].join(", "))
    end
  end
  checks, used = verify_log(runner)
  puts "\n-- Tool đã dùng theo agent --"
  used.each { |a, names| puts format("  %-13s %s", a, names.tally.map { |k, v| v > 1 ? "#{k}×#{v}" : k }.join(", ")) }
  puts "\n-- Kiểm tra --"
  checks.each { |c| puts "  #{c[:ok] ? 'PASS' : 'FAIL'}  #{c[:name]}#{c[:detail].to_s.empty? ? '' : "  [#{c[:detail]}]"}" }
  puts "\nTrả lời cuối: #{final}"
  puts "Log: #{log_path}"
end
