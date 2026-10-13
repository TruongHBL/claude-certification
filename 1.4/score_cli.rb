# frozen_string_literal: true

# Bài 1.4 – chấm kết quả bản CLI. Đọc results_cli/<kịch bản>/{tools.log, state.json, stream.jsonl}.
#
# Kiểm tra bắt buộc ở MỌI kịch bản (bất biến của cổng chặn):
#   mọi refund ĐÃ thực thi đều có get_customer verified=true của đúng khách đó xảy ra TRƯỚC trong log.
# Kiểm tra riêng từng kịch bản lấy từ scenarios.json (expect).
#
# Dùng: ruby score_cli.rb <results_dir> <scenarios.json> [id]

require "json"

results_dir, scenarios_file, only = ARGV
scenarios = JSON.parse(File.read(scenarios_file))["scenarios"]
scenarios = scenarios.select { _1["id"] == only } if only

def read_jsonl(path)
  return [] unless File.exist?(path)

  File.readlines(path).filter_map { |l| JSON.parse(l) rescue nil }
end

# Tool do model gọi, theo thứ tự, lấy từ stream-json (đối chiếu với log server).
def model_tool_calls(stream)
  stream.select { _1["type"] == "assistant" }.flat_map do |m|
    Array(m.dig("message", "content")).select { _1["type"] == "tool_use" }.map { _1["name"].to_s.sub(/\Amcp__support__/, "") }
  end
end

total_fail = 0
scenarios.each do |sc|
  dir = File.join(results_dir, sc["id"])
  log = read_jsonl(File.join(dir, "tools.log"))
  stream = read_jsonl(File.join(dir, "stream.jsonl"))
  state = File.exist?(File.join(dir, "state.json")) ? JSON.parse(File.read(File.join(dir, "state.json"))) : { "ledger" => [], "handoffs" => [] }
  result = stream.reverse.find { _1["type"] == "result" } || {}
  checks = []

  # Bất biến: refund thành công chỉ sau get_customer verified của đúng khách.
  verified = nil
  gate_ok = true
  log.each do |e|
    verified = e.dig("result", "customer_id") if e["tool"] == "get_customer" && !e["isError"] && e.dig("result", "verified") == true
    gate_ok = false if e["tool"] == "process_refund" && !e["isError"] && e.dig("arguments", "customer_id") != verified
  end
  checks << ["Cổng chặn giữ: mọi refund đã thực thi đều sau xác minh đúng khách", gate_ok]
  ledger_from_log = log.count { _1["tool"] == "process_refund" && !_1["isError"] }
  checks << ["Ledger khớp log server (#{state['ledger'].size} refund)", ledger_from_log == state["ledger"].size]

  ex = sc["expect"] || {}
  if ex["ledger_orders"]
    got = state["ledger"].map { _1["order_id"] }
    checks << ["Refund đúng đơn #{ex['ledger_orders']} (thực tế #{got})", got.sort == ex["ledger_orders"].sort]
  end
  checks << ["Không có refund nào (xác minh thất bại)", state["ledger"].empty?] if ex["ledger_empty"]
  if ex["handoff"]
    h = state["handoffs"].last
    checks << ["Có handoff được chấp nhận (đủ 5 trường)", !h.nil?]
    if h && ex["handoff_concern_types"]
      types = Array(h["concerns"]).select { _1["status"] == "needs_human" }.map { _1["type"] }
      checks << ["Handoff có concern cần người: #{ex['handoff_concern_types']} (thực tế #{types})",
                 (ex["handoff_concern_types"] - types).empty?]
    end
  end

  blocked = log.count { _1["blocked"] }
  rejected_handoffs = log.count { _1["tool"] == "escalate_to_human" && _1["isError"] }
  calls = model_tool_calls(stream)
  puts "== #{sc['id']}"
  puts "   tool model gọi (stream-json): #{calls.join(' → ')}"
  puts "   tool server nhận (log):       #{log.map { _1['tool'] + (_1['isError'] ? '✗' : '') }.join(' → ')}"
  puts "   lần bị cổng chặn: #{blocked} · handoff bị từ chối: #{rejected_handoffs} · " \
       "chi phí: #{result['total_cost_usd'] || '?'} USD · kết thúc: #{result['subtype'] || 'không có result'}"
  checks.each do |name, ok|
    total_fail += 1 unless ok
    puts "   #{ok ? 'PASS' : 'FAIL'}  #{name}"
  end
end
puts total_fail.zero? ? "\nTất cả kiểm tra đạt." : "\n#{total_fail} kiểm tra KHÔNG đạt."
exit(total_fail.zero? ? 0 : 1)
