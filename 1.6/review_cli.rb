# frozen_string_literal: true

# Bài 1.6 – bản chạy bằng Claude Code CLI (phiên đăng nhập claude.ai, KHÔNG cần API key).
#
# Khác bản API (bai_1_6_multipass_review.rb):
#   - Ép schema bằng `claude -p --json-schema <schema>` thay cho tool_choice {type:"tool"}.
#     CLI tự kiểm output theo schema và trả kết quả trong field `structured_output` của message result.
#   - Mỗi pass là một lệnh `claude -p` riêng (không chung context) → pass per-file thật sự cô lập.
#   - --tools "" tắt tool built-in: code đã nằm sẵn trong prompt, agent không cần (và không được) tự đọc file.
# Giữ nguyên: schema, quy tắc review, cách đánh số dòng, integration chỉ nhận summary/exports/imports,
# bộ chấm compare() — tất cả lấy thẳng từ bản API qua require_relative.
#
# Dùng (run_cli.sh gọi các lệnh này):
#   ruby review_cli.rb list            in tên 12 file (cho xargs -P 4)
#   ruby review_cli.rb file <tên>      pass per-file cho 1 file
#   ruby review_cli.rb single          single-pass: 1 lệnh cho cả 12 file
#   ruby review_cli.rb integrate       gộp kết quả per-file + integration pass → multi.json
#   ruby review_cli.rb compare         chấm single.json và multi.json với ANSWER_KEY.json

$LOAD_PATH.unshift(File.join(__dir__, "cli_shim")) # `require "anthropic"` của bản API → shim rỗng
require_relative "bai_1_6_multipass_review"
require "open3"
require "fileutils"

CLI_OUT = File.join(__dir__, "bai_1_6_results_cli")
CLAUDE_BIN = ENV.fetch("CLAUDE_BIN", "claude")
CLI_MODEL = ENV.fetch("MODEL", "haiku")
BUDGET = ENV.fetch("BUDGET", "0.3")

# Lấy JSON có cấu trúc từ stream-json. Chịu 3 khả năng, theo thứ tự ưu tiên:
#   1. result.structured_output   (field có trong kiểu SDKResultMessage của Agent SDK và trong binary CLI 2.1.296)
#   2. input của tool_use tên StructuredOutput (CLI hiện thực --json-schema bằng một tool nội bộ tên này)
#   3. JSON trong result.result (văn bản, có thể bọc ```json)
# Mới đọc từ type definition + chuỗi trong binary, CHƯA kiểm chứng bằng lần chạy thật.
def extract_structured(events)
  result = events.reverse.find { _1["type"] == "result" } || {}
  return [result["structured_output"], "structured_output", result] if result["structured_output"].is_a?(Hash)

  tool = events.select { _1["type"] == "assistant" }
               .flat_map { Array(_1.dig("message", "content")) }
               .reverse.find { _1["type"] == "tool_use" && _1["name"] == "StructuredOutput" }
  return [tool["input"], "StructuredOutput tool_use", result] if tool && tool["input"].is_a?(Hash)

  text = result["result"].to_s.strip.sub(/\A```(?:json)?\s*/, "").sub(/\s*```\z/, "")
  begin
    parsed = JSON.parse(text)
    return [parsed, "result text", result] if parsed.is_a?(Hash)
  rescue JSON::ParserError
    nil
  end
  raise "Không lấy được structured output (subtype=#{result['subtype'].inspect})"
end

# Một lệnh `claude -p` ép schema → Hash (khoá string). Lưu stream thô cạnh kết quả để soát lại.
def cli_structured_call(label, system, schema, user_text)
  FileUtils.mkdir_p(File.join(CLI_OUT, "raw"))
  cmd = [CLAUDE_BIN, "-p", user_text,
         "--model", CLI_MODEL,
         "--system-prompt", system,
         "--json-schema", JSON.generate(schema),
         "--tools", "",
         "--permission-mode", "dontAsk",
         "--max-budget-usd", BUDGET,
         "--no-session-persistence",
         "--output-format", "stream-json", "--verbose"]
  # Chạy trong thư mục kết quả để không nạp CLAUDE.md/settings của project nào.
  out, err, status = Open3.capture3(*cmd, chdir: CLI_OUT)
  File.write(File.join(CLI_OUT, "raw", "#{label}.jsonl"), out)
  File.write(File.join(CLI_OUT, "raw", "#{label}.err"), err) unless err.empty?
  events = out.lines.filter_map { |l| JSON.parse(l) rescue nil }
  data, source, result = extract_structured(events)
  warn "[#{label}] lấy output từ #{source} · cost #{result['total_cost_usd'] || '?'} USD#{status.success? ? '' : ' · mã lỗi ' + status.exitstatus.to_s}"
  JSON.parse(JSON.generate(data))
end

def save_cli(rel, data)
  path = File.join(CLI_OUT, rel)
  FileUtils.mkdir_p(File.dirname(path))
  File.write(path, JSON.pretty_generate(data))
end

def load_cli(rel) = JSON.parse(File.read(File.join(CLI_OUT, rel)))

PER_FILE_SYSTEM = "Bạn là reviewer JS. Chỉ review ĐÚNG MỘT file được đưa. #{REVIEW_RULES}" \
                  "Liệt kê đủ exports (chữ ký, hình dạng giá trị trả về) và imports_used (cách gọi, field đọc từ kết quả): " \
                  "pass sau dùng chúng để đối chiếu chéo file mà không đọc lại code."
INTEGRATION_SYSTEM = "Bạn kiểm tra tích hợp giữa các module. Chỉ có bản tóm tắt từng file (không có code). " \
                     "Tìm chỗ export và nơi dùng không khớp: chữ ký hàm, tên field, kiểu trả về, luồng dữ liệu. " \
                     "Không lặp lại lỗi nội bộ một file."

def cli_per_file(name)
  code = load_files.to_h.fetch(name) { abort "Không có file #{name}" }
  r = cli_structured_call("file_#{name}", PER_FILE_SYSTEM, FILE_REVIEW_TOOL[:input_schema], numbered(name, code))
  save_cli("files/#{name}.json", r.merge("file" => name)) # tên file lấy từ code, không tin model
end

def cli_single
  files = load_files
  prompt = "Review toàn bộ #{files.size} file sau.\n\n" + files.map { |n, c| numbered(n, c) }.join("\n\n")
  save_cli("single.json", cli_structured_call("single", "Bạn là reviewer JS. #{REVIEW_RULES}", SINGLE_TOOL[:input_schema], prompt))
end

def cli_integrate
  reviews = load_files.map { |n, _| load_cli("files/#{n}.json") }.sort_by { _1["file"] }
  digest = reviews.map { |r| r.slice("file", "summary", "exports", "imports_used") } # KHÔNG gửi lại code
  r = cli_structured_call("integration", INTEGRATION_SYSTEM, INTEGRATION_TOOL[:input_schema], JSON.pretty_generate(digest))
  save_cli("multi.json", { "files" => reviews, "cross_file_issues" => r["cross_file_issues"] })
end

if $PROGRAM_NAME == __FILE__
  case ARGV[0]
  when "list" then load_files.each { |n, _| puts n }
  when "file" then cli_per_file(ARGV[1] || abort("Thiếu tên file"))
  when "single" then cli_single
  when "integrate" then cli_integrate
  when "compare" then save_cli("compare.json", compare(load_cli("single.json"), load_cli("multi.json")))
  else abort "Dùng: ruby #{File.basename(__FILE__)} list|file <tên>|single|integrate|compare"
  end
end
