# frozen_string_literal: true

# Bài 1.2 – Build Exercise: Hub-and-Spoke Research Coordinator.
#
# Coordinator (hub) phân rã chủ đề, giao việc cho 2 subagent (spoke): tìm kiếm và phân tích,
# gom kết quả, chạy vòng tinh chỉnh tìm nhánh còn thiếu rồi viết báo cáo cuối.
#
# Chạy:  gem install anthropic && export ANTHROPIC_API_KEY=...
#        ruby bai_1_2_hub_and_spoke.rb ["chủ đề"]

require "json"
require "anthropic"

CLIENT = Anthropic::Client.new
MODEL = "claude-sonnet-5-5"
WEB_SEARCH = { type: "web_search_20260209", name: "web_search", max_uses: 3 }.freeze

# Mỗi lần gọi = context MỚI. Subagent chỉ biết những gì nằm trong `task`.
def run_agent(system, task, tools: nil)
  messages = [{ role: "user", content: task }]
  params = { model: MODEL, max_tokens: 4000, system_: system, messages: messages }
  params[:tools] = tools if tools
  loop do
    r = CLIENT.messages.create(**params)
    if r.stop_reason.to_s == "pause_turn" # server tool chạy chưa xong → gửi lại để chạy tiếp
      messages << { role: "assistant", content: r.content }
      next
    end
    return r.content.select { |b| b.type.to_s == "text" }.map(&:text).join
  end
end

def ask_json(system, task)
  text = run_agent(system, "#{task}\nChỉ trả về một JSON array các chuỗi, không giải thích.")
  JSON.parse(text[text.index("[")..text.rindex("]")])
end

# ---------- Subagents (spoke) ----------
def search_subagent(topic, sub)
  run_agent(
    "Bạn là subagent tìm kiếm thông tin.",
    "Bối cảnh: team đang viết báo cáo về '#{topic}'.\n" \
    "Nhiệm vụ: tìm thông tin mới, đáng tin cậy về '#{sub}'.\n" \
    "Ranh giới: CHỈ viết về '#{sub}', không lấn sang nhánh khác.\n" \
    "Output: 5–8 gạch đầu dòng, mỗi dòng kèm URL nguồn.",
    tools: [WEB_SEARCH]
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
