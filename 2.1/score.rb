# frozen_string_literal: true

# Bài 2.1 – chấm tool được gọi ĐẦU TIÊN cho từng query, từng cấu hình.
# Nguồn chính: block tool_use đầu tiên trong stream-json (qN.jsonl).
# Dự phòng: dòng đầu của log server (qN.log), nếu stream-json không đọc được.
# Dùng: ruby score.rb results queries.json

require "json"

results_dir, queries_file = ARGV
queries = JSON.parse(File.read(queries_file))["queries"]
CONFIGS = { "A" => "vague + conflict", "B" => "clear + conflict", "C" => "clear + fixed" }.freeze

def first_tool_from_stream(path)
  return nil unless File.exist?(path)

  File.foreach(path) do |line|
    ev = JSON.parse(line) rescue next
    next unless ev["type"] == "assistant"

    Array(ev.dig("message", "content")).each do |b|
      return b["name"].sub(/\Amcp__shop__/, "") if b["type"] == "tool_use"
    end
  end
  nil
end

def first_tool_from_log(path)
  return nil unless File.exist?(path) && !File.zero?(path)

  JSON.parse(File.foreach(path).first)["tool"]
end

summary = []
CONFIGS.each do |cfg, label|
  dir = File.join(results_dir, cfg)
  next unless Dir.exist?(dir)

  rows = queries.map do |q|
    got = first_tool_from_stream(File.join(dir, "q#{q['id']}.jsonl")) ||
          first_tool_from_log(File.join(dir, "q#{q['id']}.log")) || "(không gọi tool)"
    { id: q["id"], text: q["text"], expected: q["expected"], got: got, ok: got == q["expected"] }
  end
  correct = rows.count { _1[:ok] }
  summary << [cfg, label, correct, rows.size]
  puts "\n== #{cfg} (#{label}): #{correct}/#{rows.size}"
  rows.reject { _1[:ok] }.each do |r|
    puts "   ✗ q#{r[:id]}: cần #{r[:expected]}, gọi #{r[:got]}  | #{r[:text]}"
  end
end

if summary.empty?
  puts "Chưa có kết quả trong #{results_dir}. Chạy ./run.sh all trước."
  exit 1
end
puts "\nCấu hình             Đúng"
summary.each { |cfg, label, c, n| puts format("%-2s %-17s %2d/%d", cfg, label, c, n) }
File.write(File.join(results_dir, "score.json"),
           JSON.pretty_generate(summary.map { |cfg, label, c, n| { config: cfg, label: label, correct: c, total: n } }))
