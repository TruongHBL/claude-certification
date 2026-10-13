# frozen_string_literal: true

# Bài 1.6 – Build Exercise: Multi-Pass Code Review Pipeline.
#
# So sánh 2 cách review 12 file JS trong bai_1_6_sample/:
#   single  : MỘT lần gọi chứa toàn bộ 12 file → dễ bị attention dilution (file sau review nông hơn)
#   multi   : pass per-file (mỗi file 1 lần gọi, schema cố định) → pass integration chỉ nhận
#             summary/exports/imports (không nhận lại code) để tìm lỗi chéo file
#   compare : chấm cả hai bản với bai_1_6_sample/ANSWER_KEY.json
#   all     : chạy single, multi rồi compare
#
# Đây là FIXED SEQUENTIAL PIPELINE (prompt chaining): các bước định sẵn, thứ tự không đổi theo kết quả.
# Không phải dynamic decomposition (agent tự lập/sửa kế hoạch khi điều tra).
#
# Chạy:  gem install anthropic && export ANTHROPIC_API_KEY=...
#        ruby bai_1_6_multipass_review.rb all

require "json"
require "anthropic"

MODEL = "claude-sonnet-5-5"
SAMPLE_DIR = File.join(__dir__, "bai_1_6_sample")
OUT_DIR = File.join(__dir__, "bai_1_6_results")
PARALLEL = 4 # số pass per-file chạy cùng lúc
LINE_TOLERANCE = 3

ISSUE_TYPES = %w[sql_injection null_deref async_foreach missing_await off_by_one
                 signature_mismatch field_mismatch other].freeze

ISSUE_SCHEMA = {
  type: "object",
  properties: {
    line: { type: "integer", description: "Số dòng (theo số đánh ở đầu dòng)" },
    severity: { type: "string", enum: %w[critical high medium low] },
    type: { type: "string", enum: ISSUE_TYPES },
    description: { type: "string" }
  },
  required: %w[line severity type description]
}.freeze

CROSS_ISSUE_SCHEMA = {
  type: "object",
  properties: {
    files: { type: "array", items: { type: "string" }, description: "Các file liên quan (≥ 2)" },
    severity: { type: "string", enum: %w[critical high medium low] },
    type: { type: "string", enum: ISSUE_TYPES },
    description: { type: "string" }
  },
  required: %w[files severity type description]
}.freeze

# Pass per-file: ép đúng schema bằng tool bắt buộc (tool_choice type "tool").
FILE_REVIEW_TOOL = {
  name: "report_file_review",
  description: "Nộp kết quả review cho ĐÚNG MỘT file.",
  input_schema: {
    type: "object",
    properties: {
      file: { type: "string" },
      issues: { type: "array", items: ISSUE_SCHEMA },
      exports: {
        type: "array",
        description: "Mọi hàm/hằng file này export, kèm chữ ký và hình dạng giá trị trả về",
        items: {
          type: "object",
          properties: { name: { type: "string" }, signature: { type: "string" }, returns: { type: "string" } },
          required: %w[name signature returns]
        }
      },
      imports_used: {
        type: "array",
        description: "Mọi chỗ dùng thứ import từ file khác: gọi thế nào, đọc field nào của kết quả",
        items: {
          type: "object",
          properties: {
            from: { type: "string" }, name: { type: "string" }, call: { type: "string" },
            fields_used: { type: "array", items: { type: "string" } }
          },
          required: %w[from name call fields_used]
        }
      },
      summary: { type: "string", description: "1–3 câu: file làm gì" }
    },
    required: %w[file issues exports imports_used summary]
  }
}.freeze

SINGLE_TOOL = {
  name: "report_review",
  description: "Nộp kết quả review cho TẤT CẢ các file.",
  input_schema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          properties: { file: { type: "string" }, issues: { type: "array", items: ISSUE_SCHEMA } },
          required: %w[file issues]
        }
      },
      cross_file_issues: { type: "array", items: CROSS_ISSUE_SCHEMA }
    },
    required: %w[files cross_file_issues]
  }
}.freeze

INTEGRATION_TOOL = {
  name: "report_integration",
  description: "Nộp các lỗi chỉ thấy được khi đối chiếu nhiều file.",
  input_schema: {
    type: "object",
    properties: { cross_file_issues: { type: "array", items: CROSS_ISSUE_SCHEMA } },
    required: %w[cross_file_issues]
  }
}.freeze

REVIEW_RULES = <<~TXT
  Tìm lỗi thật (bảo mật, crash, sai logic, async), không bắt lỗi văn phong.
  Ghi đúng số dòng theo số đánh ở đầu mỗi dòng. Dùng type trong danh sách cho sẵn.
TXT

def load_files
  Dir[File.join(SAMPLE_DIR, "*.js")].sort.map { |p| [File.basename(p), File.read(p)] }
end

def numbered(name, code)
  body = code.lines.each_with_index.map { |l, i| format("%3d| %s", i + 1, l) }.join
  "=== #{name} ===\n#{body}"
end

# Một lần gọi bắt buộc dùng tool → trả về input của tool dưới dạng Hash (khoá string).
def forced_tool_call(client, system, tool, user_text, max_tokens: 8192)
  r = client.messages.create(
    model: MODEL, max_tokens: max_tokens, system_: system,
    tools: [tool], tool_choice: { type: "tool", name: tool[:name] },
    messages: [{ role: "user", content: user_text }]
  )
  raise "Output bị cắt (max_tokens) ở #{tool[:name]}" if r.stop_reason.to_s == "max_tokens"

  blk = r.content.find { |b| b.type.to_s == "tool_use" && b.name.to_s == tool[:name] }
  raise "Không có tool_use #{tool[:name]}" unless blk

  JSON.parse(JSON.generate(blk.input))
end

# ---------- Cách 1: single-pass ----------
def single_pass(files)
  prompt = "Review toàn bộ #{files.size} file sau.\n\n" + files.map { |n, c| numbered(n, c) }.join("\n\n")
  forced_tool_call(Anthropic::Client.new, "Bạn là reviewer JS. #{REVIEW_RULES}", SINGLE_TOOL, prompt,
                   max_tokens: 16_000)
end

# ---------- Cách 2: multi-pass ----------
def per_file_pass(client, name, code)
  system = "Bạn là reviewer JS. Chỉ review ĐÚNG MỘT file được đưa. #{REVIEW_RULES}" \
           "Liệt kê đủ exports (chữ ký, hình dạng giá trị trả về) và imports_used (cách gọi, field đọc từ kết quả): " \
           "pass sau dùng chúng để đối chiếu chéo file mà không đọc lại code."
  r = forced_tool_call(client, system, FILE_REVIEW_TOOL, numbered(name, code))
  r.merge("file" => name) # tên file lấy từ code, không tin model
end

def integration_pass(reviews)
  digest = reviews.map { |r| r.slice("file", "summary", "exports", "imports_used") }
  system = "Bạn kiểm tra tích hợp giữa các module. Chỉ có bản tóm tắt từng file (không có code). " \
           "Tìm chỗ export và nơi dùng không khớp: chữ ký hàm, tên field, kiểu trả về, luồng dữ liệu. " \
           "Không lặp lại lỗi nội bộ một file."
  forced_tool_call(Anthropic::Client.new, system, INTEGRATION_TOOL, JSON.pretty_generate(digest))
end

def multi_pass(files)
  queue = Queue.new
  files.each { |f| queue << f }
  results = Queue.new
  workers = Array.new([PARALLEL, files.size].min) do
    Thread.new do
      client = Anthropic::Client.new
      until queue.empty?
        name, code = begin
          queue.pop(true)
        rescue ThreadError
          break
        end
        results << per_file_pass(client, name, code)
      end
    end
  end
  workers.each(&:join)
  reviews = Array.new(results.size) { results.pop }.sort_by { |r| r["file"] }
  { "files" => reviews, "cross_file_issues" => integration_pass(reviews)["cross_file_issues"] }
end

# ---------- Chấm điểm ----------
def found_per_file?(result, bug)
  entry = result["files"].find { |f| f["file"] == bug["file"] } || { "issues" => [] }
  entry["issues"].any? { |i| i["type"] == bug["type"] && (i["line"].to_i - bug["line"]).abs <= LINE_TOLERANCE }
end

def found_cross?(result, bug)
  result["cross_file_issues"].any? { |c| c["type"] == bug["type"] && (bug["files"] - c["files"]).empty? }
end

def score(result, key, files)
  per = key.select { |b| b["scope"] == "per_file" }
  cross = key.select { |b| b["scope"] == "cross_file" }
  depth = files.map do |name, _|
    issues = (result["files"].find { |f| f["file"] == name } || { "issues" => [] })["issues"]
    avg = issues.empty? ? 0 : issues.sum { |i| i["description"].to_s.size } / issues.size
    { "file" => name, "issues" => issues.size, "avg_desc_chars" => avg }
  end
  {
    "per_file_found" => per.select { |b| found_per_file?(result, b) }.map { |b| b["id"] },
    "cross_file_found" => cross.select { |b| found_cross?(result, b) }.map { |b| b["id"] },
    "per_file_total" => per.size, "cross_file_total" => cross.size, "depth" => depth
  }
end

def compare(single, multi)
  key = JSON.parse(File.read(File.join(SAMPLE_DIR, "ANSWER_KEY.json")))["bugs"]
  files = load_files
  s = score(single, key, files)
  m = score(multi, key, files)
  twins = key.select { |b| b["type"] == "async_foreach" }
  consistency = { "single" => single, "multi" => multi }.transform_values do |res|
    flags = twins.map { |b| found_per_file?(res, b) }
    { "flags" => twins.map { |b| b["file"] }.zip(flags).to_h, "consistent" => flags.uniq.size == 1 }
  end
  report = {
    "single" => s, "multi" => m, "identical_code_03_11" => consistency,
    "cross_file_only_by_integration" => m["cross_file_found"] - s["cross_file_found"]
  }
  print_report(report)
  report
end

def print_report(rep)
  puts "Độ sâu theo thứ tự file (số issue | độ dài mô tả TB):"
  puts format("  %-28s %14s %14s", "file", "single", "multi")
  rep["single"]["depth"].zip(rep["multi"]["depth"]).each do |s, m|
    puts format("  %-28s %6d | %5d  %6d | %5d", s["file"], s["issues"], s["avg_desc_chars"], m["issues"], m["avg_desc_chars"])
  end
  %w[single multi].each do |k|
    r = rep[k]
    puts "#{k.ljust(6)}: lỗi trong file #{r['per_file_found'].size}/#{r['per_file_total']} " \
         "#{r['per_file_found']}, lỗi chéo file #{r['cross_file_found'].size}/#{r['cross_file_total']} #{r['cross_file_found']}"
  end
  rep["identical_code_03_11"].each do |k, v|
    puts "Đoạn forEach y hệt ở 03 & 11 – #{k}: #{v['flags']} → #{v['consistent'] ? 'nhất quán' : 'KHÔNG nhất quán (dilution)'}"
  end
  puts "Lỗi chéo file chỉ integration pass bắt được: #{rep['cross_file_only_by_integration']}"
end

def save(name, data)
  Dir.mkdir(OUT_DIR) unless Dir.exist?(OUT_DIR)
  File.write(File.join(OUT_DIR, "#{name}.json"), JSON.pretty_generate(data))
end

def load_result(name) = JSON.parse(File.read(File.join(OUT_DIR, "#{name}.json")))

if $PROGRAM_NAME == __FILE__
  case ARGV[0]
  when "single" then save("single", single_pass(load_files))
  when "multi" then save("multi", multi_pass(load_files))
  when "compare" then save("compare", compare(load_result("single"), load_result("multi")))
  when "all"
    files = load_files
    save("single", single = single_pass(files))
    save("multi", multi = multi_pass(files))
    save("compare", compare(single, multi))
  else abort "Dùng: ruby #{File.basename(__FILE__)} single|multi|compare|all"
  end
end
