#!/usr/bin/env ruby
# frozen_string_literal: true

# Bài 1.2 – bản CLI: đọc stream-json của `claude -p` và kiểm tra cấu trúc HUB-AND-SPOKE.
#
#   ruby parse_hub.rb hub.jsonl [tools.log]
#
# Cách nhận biết trong stream-json:
#   - Coordinator spawn subagent = block tool_use tên "Agent" (tên cũ "Task") ở luồng chính
#     (parent_tool_use_id = null). input có subagent_type, description, prompt.
#   - Sự kiện của subagent mang parent_tool_use_id = id của tool_use Agent đã spawn nó.
#   - Kết quả subagent trả về coordinator = tool_result có tool_use_id = id đó.

require "json"

path, tool_log = ARGV
abort "Dùng: ruby parse_hub.rb hub.jsonl [tools.log]" unless path && File.exist?(path)
SPAWN = %w[Agent Task].freeze

spawns = []            # { id:, msg_id:, type:, description:, prompt: }
by_id = {}
calls = Hash.new { |h, k| h[k] = [] } # parent_tool_use_id → tool_use trong luồng đó
returned = {}          # spawn id → độ dài kết quả trả về coordinator
final = nil

File.foreach(path) do |line|
  next if line.strip.empty?

  ev = begin
    JSON.parse(line)
  rescue JSON::ParserError
    next
  end
  parent = ev["parent_tool_use_id"]
  case ev["type"]
  when "assistant"
    msg = ev["message"] || {}
    (msg["content"] || []).each do |b|
      next unless b["type"] == "tool_use"

      calls[parent] << { id: b["id"], name: b["name"], input: b["input"] || {} }
      next unless parent.nil? && SPAWN.include?(b["name"])

      s = { id: b["id"], msg_id: msg["id"], type: b.dig("input", "subagent_type").to_s,
            description: b.dig("input", "description").to_s, prompt: b.dig("input", "prompt").to_s }
      spawns << s
      by_id[b["id"]] = s
    end
  when "user"
    content = ev.dig("message", "content")
    next unless parent.nil? && content.is_a?(Array)

    content.each do |b|
      next unless b["type"] == "tool_result" && by_id.key?(b["tool_use_id"])

      text = b["content"].is_a?(Array) ? b["content"].map { |c| c["text"] }.compact.join(" ") : b["content"].to_s
      returned[b["tool_use_id"]] = text.length
    end
  when "result" then final = ev
  end
end

short = ->(s, n = 160) { s = s.to_s.gsub(/\s+/, " "); s.length > n ? "#{s[0, n]}…" : s }

# Nhóm spawn theo message.id: cùng id = cùng một lượt của coordinator = chạy song song.
groups = spawns.group_by { _1[:msg_id] }
puts "== Prompt giao việc của coordinator (#{spawns.size} lần spawn, #{groups.size} lượt)"
groups.each_with_index do |(mid, list), gi|
  puts "Lượt spawn #{gi + 1} (#{mid || 'không có id'}) · #{list.size} subagent#{list.size > 1 ? ' SONG SONG' : ''}"
  list.each do |s|
    n_calls = calls[s[:id]].size
    puts "  [#{s[:type]}] #{s[:description]}"
    puts "     prompt: #{short.(s[:prompt])}"
    puts "     → trong luồng: #{n_calls} tool call (#{calls[s[:id]].map { _1[:name] }.tally.map { |k, v| "#{k}×#{v}" }.join(', ')})" \
         " · trả về coordinator: #{returned[s[:id]] ? "#{returned[s[:id]]} ký tự" : 'KHÔNG thấy tool_result'}"
  end
end

# Tool gọi trong luồng subagent mà KHÔNG phải spawn của coordinator (parent không phải spawn id).
orphan_parents = calls.keys.compact.reject { by_id.key?(_1) }
nested = calls.select { |p, l| !p.nil? && l.any? { SPAWN.include?(_1[:name]) } }
search_outside = calls.flat_map do |p, l|
  next [] if p && by_id[p] && by_id[p][:type] == "search-agent"

  l.select { _1[:name] == "mcp__research__search" }.map { |c| [p ? by_id.dig(p, :type) || p : "coordinator", c] }
end
analysis = spawns.select { _1[:type] == "analysis-agent" }
synth = spawns.select { _1[:type] == "synthesis-agent" }
types = spawns.map { _1[:type] }.tally

puts
puts "== Tóm tắt"
puts "Spawn theo loại: #{types.map { |k, v| "#{k}×#{v}" }.join(', ')}"
puts "Tool call của chính coordinator: #{calls[nil].map { _1[:name] }.tally.map { |k, v| "#{k}×#{v}" }.join(', ')}"
if tool_log && File.exist?(tool_log)
  n = File.readlines(tool_log).count { |l| !l.strip.empty? }
  in_stream = calls.values.flatten.count { _1[:name] == "mcp__research__search" }
  puts "MCP server ghi nhận #{n} lần search · stream-json có #{in_stream} tool_use search"
end
puts "result: subtype=#{final['subtype']} · num_turns=#{final['num_turns'].inspect} · total_cost_usd=#{final['total_cost_usd'].inspect}" if final

checks = [
  ["Mọi subagent đều do coordinator spawn (Agent ở luồng chính)", orphan_parents.empty? && !spawns.empty?],
  ["Subagent không spawn/gọi subagent khác", nested.empty?],
  ["search chỉ chạy trong search-agent (coordinator và subagent khác không tự tìm)", search_outside.empty?],
  ["Coordinator spawn ≥5 search-agent (phân rã đủ rộng)", types.fetch("search-agent", 0) >= 5],
  ["Có lượt spawn ≥2 subagent song song", groups.values.any? { _1.size >= 2 }],
  ["Prompt của analysis-agent có dán kết quả tìm kiếm kèm URL", !analysis.empty? && analysis.all? { _1[:prompt].include?("http") }],
  ["synthesis-agent được spawn sau cùng", !synth.empty? && spawns.last[:type] == "synthesis-agent"],
  ["Mọi subagent đều trả kết quả về coordinator (tool_result)", spawns.all? { returned.key?(_1[:id]) }]
]
puts
checks.each { |name, ok| puts "#{ok ? 'PASS' : 'FAIL'}  #{name}" }
nested.each { |p, l| puts "  ↳ vi phạm: #{by_id.dig(p, :type) || p} gọi #{l.select { SPAWN.include?(_1[:name]) }.map { _1.dig(:input, 'subagent_type') }.join(', ')}" }
search_outside.each { |who, c| puts "  ↳ vi phạm: #{who} tự gọi search #{JSON.generate(c[:input])}" }
exit(checks.all? { _2 } ? 0 : 1)
