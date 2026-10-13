# frozen_string_literal: true

# Bài 1.2 – Build Exercise (bản chạy qua proxy OpenAI-compatible, KHÔNG phải Claude API chính thức).
#
# Khác bản chính:
#   - Gọi /v1/chat/completions bằng Net::HTTP (không cần gem).
#   - Vòng lặp dựa vào finish_reason ("tool_calls" / "stop") thay cho stop_reason ("tool_use" / "end_turn").
#   - Không có server tool web_search của Anthropic → subagent tìm kiếm dùng tool `search` GIẢ LẬP chạy local.
#
# Chạy:  export PROXY_API_KEY=...
#        export PROXY_MODEL=...        # tên model theo nhà cung cấp proxy
#        export PROXY_BASE_URL=https://api.xah.io/v1   # (mặc định)
#        ruby bai_1_2_hub_and_spoke_proxy.rb ["chủ đề"]

require "json"
require "net/http"
require "uri"

BASE_URL = ENV.fetch("PROXY_BASE_URL", "https://api.xah.io/v1")
MODEL = ENV.fetch("PROXY_MODEL") { abort "Thiếu PROXY_MODEL (xem danh sách model của proxy: GET #{BASE_URL}/models)" }
MAX_TOOL_TURNS = 10 # lưới an toàn cho vòng lặp tool, không phải điều kiện dừng chính

SEARCH_TOOL = {
  type: "function",
  function: {
    name: "search",
    description: "Tìm thông tin về một chủ đề. Trả về danh sách kết quả ngắn kèm nguồn.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Câu truy vấn tìm kiếm" } },
      required: ["query"]
    }
  }
}.freeze

# Tool tìm kiếm GIẢ LẬP – thay bằng API tìm kiếm thật nếu cần.
def fake_search(query)
  "[MOCK] 3 kết quả cho '#{query}':\n" \
  "- Tổng quan về #{query} (nguồn: example.com/a)\n" \
  "- Số liệu gần đây về #{query} (nguồn: example.com/b)\n" \
  "- Thách thức và triển vọng của #{query} (nguồn: example.com/c)"
end

def chat(messages, tools = nil)
  uri = URI("#{BASE_URL}/chat/completions")
  body = { model: MODEL, max_tokens: 4000, messages: messages }
  body[:tools] = tools if tools
  req = Net::HTTP::Post.new(uri, "Content-Type" => "application/json",
                                 "Authorization" => "Bearer #{ENV.fetch('PROXY_API_KEY')}")
  req.body = JSON.generate(body)
  res = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", read_timeout: 180) { |h| h.request(req) }
  raise "HTTP #{res.code}: #{res.body[0, 500]}" unless res.is_a?(Net::HTTPSuccess)

  JSON.parse(res.body)["choices"][0]
end

# Mỗi lần gọi = context MỚI. Subagent chỉ biết những gì nằm trong `task`.
def run_agent(system, task, tools: nil)
  messages = [{ role: "system", content: system }, { role: "user", content: task }]
  MAX_TOOL_TURNS.times do
    choice = chat(messages, tools)
    msg = choice["message"]
    case choice["finish_reason"]
    when "tool_calls" # tương đương stop_reason "tool_use" → chạy tool, nối kết quả, lặp tiếp
      messages << msg
      msg["tool_calls"].each do |tc|
        args = JSON.parse(tc.dig("function", "arguments") || "{}")
        messages << { role: "tool", tool_call_id: tc["id"], content: fake_search(args["query"].to_s) }
      end
    when "stop" # tương đương "end_turn" → xong
      return msg["content"].to_s
    else # "length", "content_filter"... → chưa hoàn chỉnh, cần kiểm tra
      warn "CẢNH BÁO: finish_reason=#{choice['finish_reason']}"
      return msg["content"].to_s
    end
  end
  warn "CẢNH BÁO: chạm MAX_TOOL_TURNS"
  ""
end

def ask_json(system, task)
  text = run_agent(system, "#{task}\nChỉ trả về một JSON array các chuỗi, không giải thích.")
  JSON.parse(text[text.index("[")..text.rindex("]")])
end

# ---------- Subagents (spoke) ----------
def search_subagent(topic, sub)
  run_agent(
    "Bạn là subagent tìm kiếm thông tin. Hãy dùng tool search trước khi trả lời.",
    "Bối cảnh: team đang viết báo cáo về '#{topic}'.\n" \
    "Nhiệm vụ: tìm thông tin về '#{sub}'.\n" \
    "Ranh giới: CHỈ viết về '#{sub}', không lấn sang nhánh khác.\n" \
    "Output: 5–8 gạch đầu dòng, mỗi dòng kèm nguồn.",
    tools: [SEARCH_TOOL]
  )
end

def analysis_subagent(topic, sub, findings)
  run_agent(
    "Bạn là subagent phân tích tài liệu.",
    "Báo cáo về '#{topic}', phần '#{sub}'.\n" \
    "Dữ liệu (do coordinator chuyển, chỉ được dùng dữ liệu này):\n#{findings}\n" \
    "Output: 1 đoạn gồm hiện trạng, ưu điểm, hạn chế, triển vọng."
  )
end

# ---------- Coordinator (hub) ----------
def decompose(topic)
  ask_json(
    "Bạn là coordinator của hệ thống research.",
    "Chia chủ đề '#{topic}' thành các nhánh con bao phủ TOÀN BỘ phạm vi " \
    "(tối thiểu 5), không trùng lặp nhau."
  )
end

def find_gaps(topic, covered)
  ask_json(
    "Bạn là coordinator, đang kiểm tra độ phủ của báo cáo.",
    "Chủ đề: '#{topic}'. Các nhánh đã có: #{covered}.\n" \
    "Liệt kê các nhánh QUAN TRỌNG còn thiếu. Trả [] nếu đã đủ."
  )
end

def coordinator(topic, max_rounds: 3)
  sections = {}
  todo = decompose(topic)
  puts "Phân rã: #{todo}"
  max_rounds.times do |rnd| # lưới an toàn, không phải điều kiện dừng chính
    todo.each do |sub|
      findings = search_subagent(topic, sub)                   # spoke 1
      sections[sub] = analysis_subagent(topic, sub, findings)  # coordinator chuyển dữ liệu sang spoke 2
      puts "[round #{rnd}] xong nhánh: #{sub}"
    end
    todo = find_gaps(topic, sections.keys).reject { |g| sections.key?(g) }
    break if todo.empty? # đủ phạm vi → dừng
    puts "[round #{rnd}] còn thiếu: #{todo}"
  end
  warn "CẢNH BÁO: hết số vòng mà vẫn còn nhánh thiếu: #{todo}" unless todo.empty?
  body = sections.map { |k, v| "## #{k}\n#{v}" }.join("\n\n")
  run_agent(
    "Bạn là người viết báo cáo.",
    "Viết báo cáo tổng hợp về '#{topic}' từ các phần sau, giữ nguyên nguồn:\n#{body}"
  )
end

puts coordinator(ARGV[0] || "Renewable energy technologies") if $PROGRAM_NAME == __FILE__
