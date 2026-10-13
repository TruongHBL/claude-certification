#!/usr/bin/env ruby
# frozen_string_literal: true

# Bài 1.1 – bản CLI: đọc stream-json của `claude -p` và in lại VÒNG LẶP AGENT từng lượt.
#
#   ruby parse_loop.rb loop.jsonl [tools.log]
#
# Một lượt = một response của API (gom theo message.id). Lưu ý: stream-json có thể tách MỘT response
# thành NHIỀU dòng "assistant" (mỗi content block một dòng) cùng message.id, nên phải gom theo id,
# không đếm theo số dòng. stop_reason lấy từ dòng có giá trị khác null; nếu CLI không ghi thì
# SUY RA (có tool_use → tool_use, không có → end_turn) và đánh dấu "(suy ra)".

require "json"

path, tool_log = ARGV
abort "Dùng: ruby parse_loop.rb loop.jsonl [tools.log]" unless path && File.exist?(path)

turns = {}   # message.id → { blocks:, stop_reason: }
order = []
results = {} # tool_use_id → { content:, is_error: }
final = nil
init = nil

File.foreach(path) do |line|
  next if line.strip.empty?

  ev = begin
    JSON.parse(line)
  rescue JSON::ParserError
    next
  end
  next unless ev["parent_tool_use_id"].nil? # chỉ xem luồng chính (bài 1.1 không có subagent)

  case ev["type"]
  when "system" then init ||= ev if ev["subtype"] == "init"
  when "assistant"
    msg = ev["message"] || {}
    id = msg["id"] || "noid-#{order.size}"
    unless turns.key?(id)
      turns[id] = { blocks: [], stop_reason: nil }
      order << id
    end
    turns[id][:blocks].concat(msg["content"] || [])
    turns[id][:stop_reason] = msg["stop_reason"] if msg["stop_reason"]
  when "user"
    content = ev.dig("message", "content")
    next unless content.is_a?(Array)

    content.each do |b|
      next unless b["type"] == "tool_result"

      text = b["content"].is_a?(Array) ? b["content"].map { |c| c["text"] }.compact.join(" ") : b["content"].to_s
      results[b["tool_use_id"]] = { content: text, is_error: b["is_error"] ? true : false }
    end
  when "result" then final = ev
  end
end

short = ->(s, n = 110) { s = s.to_s.gsub(/\s+/, " "); s.length > n ? "#{s[0, n]}…" : s }

puts "Tool khả dụng (system:init): #{(init && init['tools'] || []).join(', ')}" if init
puts
tool_calls = 0
unmatched = []
order.each_with_index do |id, i|
  t = turns[id]
  uses = t[:blocks].select { |b| b["type"] == "tool_use" }
  sr = t[:stop_reason] || "#{uses.empty? ? 'end_turn' : 'tool_use'} (suy ra)"
  t[:sr] = sr
  puts "Lượt #{i + 1} · #{id} · stop_reason=#{sr}"
  t[:blocks].each do |b|
    case b["type"]
    when "text" then puts "  text     : #{short.(b['text'])}" unless b["text"].to_s.strip.empty?
    when "thinking" then puts "  thinking : (#{b['thinking'].to_s.length} ký tự)"
    when "tool_use"
      tool_calls += 1
      puts "  tool_use : #{b['id']} #{b['name']} #{JSON.generate(b['input'])}"
      r = results[b["id"]]
      if r
        puts "    ↳ tool_result#{r[:is_error] ? ' [is_error]' : ''} (#{b['id']}): #{short.(r[:content])}"
      else
        unmatched << b["id"]
        puts "    ↳ (không thấy tool_result cho #{b['id']})"
      end
    end
  end
  puts
end

last_sr = order.empty? ? nil : turns[order.last][:sr]
puts "== Tóm tắt"
puts "Số lượt API (gom theo message.id): #{order.size}"
puts "Số tool_use: #{tool_calls}  ·  tool_result ghép được: #{tool_calls - unmatched.size}/#{tool_calls}"
if tool_log && File.exist?(tool_log)
  n = File.readlines(tool_log).count { |l| !l.strip.empty? }
  puts "MCP server ghi nhận: #{n} lần tools/call #{n == tool_calls ? '(khớp số tool_use)' : '(KHÔNG khớp số tool_use)'}"
end
puts "stop_reason lượt cuối: #{last_sr || '(không có)'}"
if final
  puts "result: subtype=#{final['subtype']} · num_turns=#{final['num_turns'].inspect} · " \
       "total_cost_usd=#{final['total_cost_usd'].inspect}"
  puts "Câu trả lời: #{short.(final['result'], 300)}"
end

checks = [
  ["Mọi lượt trước lượt cuối đều dừng vì tool_use", order[0...-1].all? { |id| turns[id][:sr].start_with?("tool_use") }],
  ["Lượt cuối dừng vì end_turn", last_sr.to_s.start_with?("end_turn")],
  ["Mọi tool_use đều có tool_result ghép theo tool_use_id", unmatched.empty?],
  ["Có dùng tool (không tự trả lời ngay)", tool_calls.positive?]
]
puts
checks.each { |name, ok| puts "#{ok ? 'PASS' : 'FAIL'}  #{name}" }

puts <<~MAP

  == Đối chiếu với vòng lặp tự viết (bai_1_1_agentic_loop.rb)
  - Bản API: code của mình gọi messages.create, đọc stop_reason, chạy tool, nối tool_result, quyết định dừng.
  - Bản CLI: Claude Code làm toàn bộ việc đó. Mỗi "Lượt" ở trên tương ứng một vòng `MAX_ITERATIONS.times`
    của bản API; mỗi dòng ↳ tương ứng một phần tử `results` trong message user.
  - KHÔNG làm được bằng CLI: tự đặt điều kiện dừng, tự xử lý stop_reason lạ (max_tokens, refusal),
    tự quyết MAX_ITERATIONS. Ở đây chỉ QUAN SÁT được vòng lặp của Claude Code.
MAP
exit(checks.all? { _2 } ? 0 : 1)
