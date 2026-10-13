# frozen_string_literal: true

# Bài 1.1 – Build Exercise: Multi-Tool Agent Loop.
#
# Vòng lặp agent tự viết bằng Messages API với 2 tool (calculator, web_search giả lập).
# Điều khiển vòng lặp CHỈ bằng stop_reason: "tool_use" → chạy tool, nối kết quả, lặp tiếp;
# "end_turn" → trả kết quả. MAX_ITERATIONS chỉ là lưới an toàn.
#
# Chạy:  gem install anthropic && export ANTHROPIC_API_KEY=...
#        ruby bai_1_1_agentic_loop.rb ["câu hỏi"]

require "json"
require "anthropic"

CLIENT = Anthropic::Client.new
MODEL = "claude-sonnet-5-5"
MAX_ITERATIONS = 20 # lưới an toàn, KHÔNG phải điều kiện dừng chính

TOOLS = [
  {
    name: "web_search",
    description: "Tìm số liệu thực tế (dân số, diện tích...) về một chủ đề. " \
                 "Dùng khi cần dữ kiện chưa có trong hội thoại. Trả về một đoạn văn ngắn có số liệu.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Câu truy vấn, ví dụ 'dân số Hà Nội 2024'" } },
      required: ["query"]
    }
  },
  {
    name: "calculator",
    description: "Tính biểu thức số học gồm + - * / và dấu ngoặc. Dùng cho MỌI phép tính thay vì tự tính nhẩm.",
    input_schema: {
      type: "object",
      properties: { expression: { type: "string", description: "Biểu thức, ví dụ '(9.5 - 8.7) / 8.7 * 100'" } },
      required: ["expression"]
    }
  }
].freeze

# ---------- Tool implementations ----------
# Dữ liệu GIẢ LẬP cho bài tập (không phải số liệu chính thức).
MOCK_FACTS = {
  "hà nội" => "Dân số Hà Nội năm 2024 khoảng 8,7 triệu người (số liệu giả lập).",
  "hồ chí minh" => "Dân số TP. Hồ Chí Minh năm 2024 khoảng 9,5 triệu người (số liệu giả lập).",
  "hcm" => "Dân số TP. Hồ Chí Minh năm 2024 khoảng 9,5 triệu người (số liệu giả lập)."
}.freeze

def web_search(query)
  q = query.downcase
  hit = MOCK_FACTS.find { |k, _| q.include?(k) }
  hit ? hit[1] : "Không tìm thấy kết quả cho '#{query}'."
end

# Parser đệ quy nhỏ cho + - * / ( ) — không dùng eval.
class Calc
  def self.evaluate(str) = new(str).parse

  def initialize(str)
    @tokens = str.scan(%r{\d+(?:[.,]\d+)?|[-+*/()]}).map { |t| t.tr(",", ".") }
    rest = str.gsub(%r{\d+(?:[.,]\d+)?|[-+*/()]|\s}, "")
    raise ArgumentError, "ký tự không hợp lệ: #{rest}" unless rest.empty?
  end

  def parse
    v = expr
    raise ArgumentError, "thừa token: #{@tokens.join}" unless @tokens.empty?
    v
  end

  private

  def expr
    v = term
    while %w[+ -].include?(@tokens.first)
      @tokens.shift == "+" ? v += term : v -= term
    end
    v
  end

  def term
    v = factor
    while %w[* /].include?(@tokens.first)
      if @tokens.shift == "*"
        v *= factor
      else
        d = factor
        raise ZeroDivisionError, "chia cho 0" if d.zero?
        v /= d
      end
    end
    v
  end

  def factor
    t = @tokens.shift or raise ArgumentError, "biểu thức chưa đầy đủ"
    case t
    when "(" then v = expr; @tokens.shift == ")" ? v : raise(ArgumentError, "thiếu ')'")
    when "-" then -factor
    when "+" then factor
    else Float(t)
    end
  end
end

def run_tool(name, input)
  arg = ->(k) { (input[k.to_sym] || input[k.to_s]).to_s }
  case name.to_s
  when "web_search" then [web_search(arg.("query")), false]
  when "calculator" then [Calc.evaluate(arg.("expression")).round(4).to_s, false]
  else ["Tool không tồn tại: #{name}", true]
  end
rescue ArgumentError, ZeroDivisionError => e
  ["Lỗi: #{e.message}", true] # trả lỗi có cấu trúc để Claude tự sửa input
end

# ---------- Agentic loop ----------
def agent(question)
  messages = [{ role: "user", content: question }]
  MAX_ITERATIONS.times do |i|
    r = CLIENT.messages.create(model: MODEL, max_tokens: 2000, tools: TOOLS, messages: messages)
    messages << { role: "assistant", content: r.content } # luôn nối lượt của Claude vào history

    case r.stop_reason.to_s
    when "end_turn"
      return r.content.select { |b| b.type.to_s == "text" }.map(&:text).join
    when "tool_use"
      results = r.content.select { |b| b.type.to_s == "tool_use" }.map do |b|
        out, err = run_tool(b.name, b.input)
        puts "[iter #{i}] #{b.name}(#{b.input.to_h.to_json}) → #{out}"
        { type: "tool_result", tool_use_id: b.id, content: out, is_error: err }
      end
      messages << { role: "user", content: results } # mọi kết quả trong MỘT message user
    else # max_tokens, refusal, pause_turn... → không coi là xong, báo ra để xử lý
      raise "Dừng bất thường: stop_reason=#{r.stop_reason}"
    end
  end
  warn "CẢNH BÁO: chạm MAX_ITERATIONS=#{MAX_ITERATIONS} — vòng lặp có thể đang bị kẹt"
  nil
end

if $PROGRAM_NAME == __FILE__
  q = ARGV[0] || "Tổng dân số Hà Nội và TP. Hồ Chí Minh năm 2024 là bao nhiêu? " \
                 "TP. Hồ Chí Minh đông hơn Hà Nội bao nhiêu phần trăm?"
  puts agent(q)
end
