# frozen_string_literal: true

# Bài 2.3 – bản CLI: chấm một lần chạy `claude -p` từ 3 log trong thư mục:
#   hook.jsonl   – guard_hook.rb: mọi lệnh gọi tool, agent nào gọi, pass/deny + luật
#   server.jsonl – research_mcp_server.rb: lệnh gọi THỰC SỰ được thực thi
#   stream.jsonl – stream-json của claude: kết quả cuối, chi phí, số lượt
#
#   ruby audit_cli.rb logs/cli/run
#   ruby audit_cli.rb logs/cli/misuse --misuse   # mong đợi: có vi phạm VÀ bị chặn
# Thoát 0 nếu mọi kiểm tra của chế độ đó đạt.

require "json"
require_relative "tool_config"

def read_jsonl(path)
  return [] unless File.exist?(path)

  File.readlines(path).filter_map { |l| JSON.parse(l) unless l.strip.empty? rescue nil }
end

def audit(dir, misuse: false)
  hook = read_jsonl(File.join(dir, "hook.jsonl"))
  server = read_jsonl(File.join(dir, "server.jsonl"))
  stream = read_jsonl(File.join(dir, "stream.jsonl"))
  checks = []
  add = ->(name, ok, detail = "") { checks << { name: name, ok: ok, detail: detail } }

  passed = hook.select { |e| e["decision"] == "pass" }
  denied = hook.select { |e| e["decision"] == "deny" }
  violations = denied.select { |e| %w[outside_allowlist unknown_agent].include?(e["rule"]) }
  gate_denials = denied.select { |e| e["rule"] == "metadata_gate" }

  # Bảng tool theo agent (chỉ lệnh được cho qua)
  table = Hash.new { |h, k| h[k] = Hash.new(0) }
  passed.each { |e| table[e["agent"]][e["tool"]] += 1 }

  add.("có log hook (hook PreToolUse thực sự chạy)", !hook.empty?, "#{hook.size} lệnh gọi tool")

  outside = passed.reject { |e| e["role"] && ToolConfig.allowed_names(e["role"]).include?(e["tool"]) }
  add.("mọi lệnh được cho qua đều nằm trong bộ tool của agent gọi", outside.empty?,
       outside.map { |e| "#{e['agent']}→#{e['tool']}" }.uniq.join(", "))

  # Mọi lệnh server thực thi phải từng được hook cho qua (không có đường vòng qua hook).
  mcp_passed = passed.reject { |e| e["tool"] == "Agent" }.map { |e| e["tool"] }.tally
  exec = server.map { |e| e["tool"] }.tally
  bypass = exec.select { |t, n| n > mcp_passed.fetch(t, 0) }
  add.("server chỉ thực thi lệnh đã qua hook", bypass.empty?, bypass.map { |t, n| "#{t}×#{n}" }.join(", "))
  leaked = violations.map { |e| e["tool"] } & exec.keys.reject { |t| mcp_passed.key?(t) }
  add.("lệnh vi phạm không được thực thi", leaked.empty?, leaked.join(", "))

  doc = passed.select { |e| e["role"] == "doc_analysis" }.group_by { |e| e["agent_id"] || "#{e['session_id']}-#{e['agent_type']}" }
  firsts = doc.transform_values { |es| es.first["tool"] }
  add.("doc-analysis: lệnh đầu tiên được thực thi trong mỗi phiên là extract_metadata (#{doc.size} phiên)",
       !doc.empty? && firsts.values.all?("extract_metadata"),
       "#{firsts.values.tally.map { |k, v| "#{k}×#{v}" }.join(', ')}; cổng hook chặn #{gate_denials.size} lệnh sai thứ tự")

  syn = table["synthesis"]
  add.("synthesis dùng compile_report + verify_fact", syn["compile_report"].positive? && syn["verify_fact"].positive?,
       syn.map { |k, v| "#{k}×#{v}" }.join(", "))

  report = server.reverse.find { |e| e["tool"] == "compile_report" && !e["isError"] }
  pending = report ? Array(report.dig("args", "needs_coordinator_verification")) : []
  verified_later = passed.any? { |e| e["role"] == "doc_analysis" && e["tool"] == "verify_claim" }
  add.("nhận định phức tạp được chuyển coordinator → doc-analysis verify_claim",
       pending.empty? || verified_later,
       pending.empty? ? "báo cáo không có nhận định chờ kiểm chứng" : "#{pending.size} nhận định chờ, verify_claim: #{verified_later}")

  coord_domain = passed.select { |e| e["role"] == "coordinator" && !%w[Agent review_output request_revision].include?(e["tool"]) }
  add.("coordinator không tự dùng tool nghiệp vụ", coord_domain.empty?, coord_domain.map { |e| e["tool"] }.uniq.join(", "))

  if misuse
    add.("DEMO cấu hình sai: hook bắt được ≥ 1 vi phạm", !violations.empty?,
         violations.map { |e| "#{e['agent']}→#{e['tool']}" }.join(", "))
  else
    add.("không có vi phạm", violations.empty?, "#{violations.size} vi phạm")
  end

  result = stream.reverse.find { |e| e["type"] == "result" }
  add.("claude kết thúc không lỗi", result && result["is_error"] == false,
       result ? "subtype=#{result['subtype']}" : "không có sự kiện result trong stream.jsonl")

  { checks: checks, table: table, violations: violations, gate_denials: gate_denials, result: result,
    fake: stream.any? { |e| e["type"] == "system" && e["fake"] } }
end

def print_report(r)
  puts(r[:fake] ? "(log từ `claude` GIẢ – kịch bản cố định, không phải Claude)" : "(log từ claude thật)")
  puts "\nTool theo agent (lệnh được cho qua):"
  r[:table].each { |agent, tools| puts format("  %-13s %s", agent, tools.map { |k, v| "#{k}×#{v}" }.join(", ")) }
  unless r[:gate_denials].empty?
    puts "\nCổng extract_metadata đã chặn:"
    r[:gate_denials].each { |e| puts "  #{e['agent']} (#{e['agent_id']}) → #{e['tool']}" }
  end
  unless r[:violations].empty?
    puts "\nVi phạm bị hook chặn:"
    r[:violations].each { |e| puts "  #{e['agent']} → #{e['tool']} [#{e['rule']}]" }
  end
  if (res = r[:result])
    puts "\nChi phí: #{res['total_cost_usd'].inspect} USD · số lượt: #{res['num_turns'].inspect}"
  end
  puts "\nKiểm tra:"
  r[:checks].each { |c| puts "  #{c[:ok] ? 'ĐẠT ' : 'TRƯỢT'} #{c[:name]}#{c[:detail].to_s.empty? ? '' : " — #{c[:detail]}"}" }
  n = r[:checks].count { |c| c[:ok] }
  puts "\n#{n}/#{r[:checks].size} đạt"
end

if $PROGRAM_NAME == __FILE__
  dir = ARGV.find { |a| !a.start_with?("--") } or abort "Dùng: ruby audit_cli.rb <thư_mục_log> [--misuse]"
  r = audit(dir, misuse: ARGV.include?("--misuse"))
  print_report(r)
  exit(r[:checks].all? { |c| c[:ok] } ? 0 : 1)
end
