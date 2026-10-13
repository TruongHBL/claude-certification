# frozen_string_literal: true

# Test bản CLI bài 1.6 (GIẢ: `claude` giả trong test/bin, kết quả dựng từ ANSWER_KEY).
# Kiểm: cờ CLI, số lệnh, song song, integration không nhận code, parser 3 kênh, compare chạy đúng.
# Chạy: ruby test/run_cli_tests.rb

require "json"
require "open3"
require "tmpdir"
require "fileutils"

ROOT = File.expand_path("..", __dir__)
OUT = File.join(ROOT, "bai_1_6_results_cli")
$pass = 0
$fail = 0
def check(name, ok)
  ok ? $pass += 1 : $fail += 1
  puts "#{ok ? 'PASS' : 'FAIL'}  #{name}"
end

Dir.mktmpdir do |d|
  backup = File.exist?(OUT) ? File.join(d, "bak") : nil
  FileUtils.mv(OUT, backup) if backup
  argv_log = File.join(d, "argv.log")
  env = { "CLAUDE_BIN" => File.join(ROOT, "test/bin/claude"), "FAKE_ARGV_LOG" => argv_log }
  out, status = Open3.capture2e(env, File.join(ROOT, "run_cli.sh"), "all")
  puts out.lines.map { "   | #{_1}" }.join
  check "run_cli.sh all chạy xong (mã 0)", status.success?

  argv = File.readlines(argv_log).map { JSON.parse(_1) }
  opt = ->(a, n) { i = a.index(n); i && a[i + 1] }
  check "đúng 14 lệnh claude (1 single + 12 per-file + 1 integration)", argv.size == 14
  check "mọi lệnh: -p, --json-schema, --tools \"\", dontAsk, stream-json, --no-session-persistence",
        argv.all? do |a|
          a.include?("-p") && opt.(a, "--json-schema") && opt.(a, "--tools") == "" &&
            opt.(a, "--permission-mode") == "dontAsk" && opt.(a, "--output-format") == "stream-json" &&
            a.include?("--no-session-persistence")
        end
  per_file = argv.select { JSON.parse(opt.(_1, "--json-schema"))["properties"].key?("exports") }
  check "12 lệnh per-file, mỗi lệnh chứa ĐÚNG 1 file", per_file.size == 12 && per_file.all? { opt.(_1, "-p").scan(/^=== /).size == 1 }
  check "schema per-file = FILE_REVIEW_TOOL.input_schema của bản API",
        JSON.parse(opt.(per_file.first, "--json-schema"))["required"] == %w[file issues exports imports_used summary]
  integ = argv.find { JSON.parse(opt.(_1, "--json-schema"))["properties"].keys == ["cross_file_issues"] }
  check "integration pass KHÔNG nhận code (không có dòng đánh số kiểu '  1| ')", integ && opt.(integ, "-p") !~ /^\s*\d+\| /
  check "integration pass nhận summary/exports/imports_used của 12 file",
        integ && JSON.parse(opt.(integ, "-p")).size == 12 && JSON.parse(opt.(integ, "-p")).first.keys.sort == %w[exports file imports_used summary]

  check "parser đọc được kênh structured_output", out.include?("lấy output từ structured_output")
  check "parser đọc được kênh tool_use StructuredOutput", out.include?("lấy output từ StructuredOutput tool_use")
  check "parser đọc được JSON trong result.result", out.include?("lấy output từ result text")
  check "ghi 12 file kết quả per-file + raw stream", Dir[File.join(OUT, "files", "*.json")].size == 12 &&
                                                       Dir[File.join(OUT, "raw", "*.jsonl")].size == 14
  cmp = JSON.parse(File.read(File.join(OUT, "compare.json")))
  check "compare (bộ chấm bản API) chạy trên kết quả CLI: multi 8/8, 2/2",
        cmp["multi"]["per_file_found"].size == 8 && cmp["multi"]["cross_file_found"].size == 2
  check "compare: single bỏ sót theo kịch bản giả (5/8, 0/2)",
        cmp["single"]["per_file_found"].size == 5 && cmp["single"]["cross_file_found"].empty?
  check "compare: lỗi chéo file chỉ integration bắt được = C1, C2", cmp["cross_file_only_by_integration"].sort == %w[C1 C2]

  # Parser báo lỗi rõ ràng khi không có output có cấu trúc.
  $LOAD_PATH.unshift(File.join(ROOT, "cli_shim"))
  load File.join(ROOT, "review_cli.rb")
  err = begin
    extract_structured([{ "type" => "result", "subtype" => "error_max_structured_output_retries", "result" => "xin lỗi" }])
    nil
  rescue RuntimeError => e
    e.message
  end
  check "parser raise khi không có structured output (nêu subtype)", err&.include?("error_max_structured_output_retries")

  FileUtils.rm_rf(OUT)
  FileUtils.mv(backup, OUT) if backup
end

puts "\n#{$pass} PASS, #{$fail} FAIL"
exit($fail.zero? ? 0 : 1)
