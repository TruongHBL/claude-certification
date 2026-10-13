# frozen_string_literal: true

# Kiểm thử bản CLI của bài 2.3. Chạy: ruby test/run_cli_tests.rb
#   hook   : THẬT – chạy cli/guard_hook.rb như Claude Code chạy (JSON trên stdin), đọc output + log
#   server : THẬT – bơm JSON-RPC vào cli/research_mcp_server.rb qua stdio
#   config : THẬT – agents.json / mcp.json / settings.json sinh từ tool_config.rb
#   audit  : THẬT – audit_cli.rb trên log dựng tay (cả log đúng lẫn log sai)
#   e2e    : `claude` GIẢ (test/bin/claude) – kịch bản cố định, không phải Claude

require "json"
require "open3"
require "tmpdir"
require "fileutils"
require_relative "../cli/cli_config"
require_relative "../audit_cli"

ROOT = File.expand_path("..", __dir__)
$pass = 0
$fail = 0
def check(name, cond)
  if cond
    $pass += 1
    puts "PASS  #{name}"
  else
    $fail += 1
    puts "FAIL  #{name}"
  end
end

TMP = Dir.mktmpdir("bai23cli")

# ---------------------------------------------------------------- hook
puts "== hook PreToolUse (guard_hook.rb, chạy thật) =="
HOOK_LOG = File.join(TMP, "hook.jsonl")
STATE = File.join(TMP, "state")
def hook(tool, agent_type: nil, agent_id: nil, session: "s1", input: {})
  payload = { session_id: session, hook_event_name: "PreToolUse", tool_name: tool, tool_input: input }
  payload[:agent_type] = agent_type if agent_type
  payload[:agent_id] = agent_id if agent_id
  out, st = Open3.capture2({ "GUARD_LOG" => HOOK_LOG, "GUARD_STATE" => STATE }, "ruby",
                           File.join(ROOT, "cli/guard_hook.rb"), stdin_data: JSON.generate(payload))
  dec = out.strip.empty? ? nil : JSON.parse(out).dig("hookSpecificOutput", "permissionDecision")
  [dec, st.exitstatus]
end
M = "mcp__research__"
check("coordinator (luồng chính, --agent coordinator) gọi Agent → cho qua", hook("Agent", agent_type: "coordinator") == [nil, 0])
check("luồng chính không có agent_type vẫn được coi là coordinator", hook("Agent") == [nil, 0])
check("coordinator gọi search_web → deny", hook("#{M}search_web", agent_type: "coordinator") == ["deny", 0])
check("coordinator gọi review_output → cho qua", hook("#{M}review_output", agent_type: "coordinator") == [nil, 0])
check("web-search gọi load_document → cho qua", hook("#{M}load_document", agent_type: "web-search", agent_id: "w1") == [nil, 0])
check("synthesis gọi search_web → deny", hook("#{M}search_web", agent_type: "synthesis", agent_id: "s1") == ["deny", 0])
check("synthesis gọi verify_fact (scoped) → cho qua", hook("#{M}verify_fact", agent_type: "synthesis", agent_id: "s1") == [nil, 0])
check("agent lạ (general-purpose) → deny mọi tool", hook("#{M}search_web", agent_type: "general-purpose", agent_id: "g1") == ["deny", 0])
check("subagent gọi Agent (lồng) → deny", hook("Agent", agent_type: "web-search", agent_id: "w1") == ["deny", 0])
check("doc-analysis: extract_data_points trước metadata → deny (cổng)",
      hook("#{M}extract_data_points", agent_type: "doc-analysis", agent_id: "d1") == ["deny", 0])
check("doc-analysis: extract_metadata → cho qua", hook("#{M}extract_metadata", agent_type: "doc-analysis", agent_id: "d1") == [nil, 0])
check("doc-analysis: sau metadata, extract_data_points → cho qua",
      hook("#{M}extract_data_points", agent_type: "doc-analysis", agent_id: "d1") == [nil, 0])
check("doc-analysis phiên mới (agent_id khác) → cổng đóng lại",
      hook("#{M}summarize_content", agent_type: "doc-analysis", agent_id: "d2") == ["deny", 0])
check("doc-analysis: tool ngoài bộ (compile_report) → deny dù đã qua cổng",
      hook("#{M}compile_report", agent_type: "doc-analysis", agent_id: "d1") == ["deny", 0])
check("dự phòng thiếu agent_id: cổng theo session + agent_type",
      hook("#{M}verify_claim", agent_type: "doc-analysis", session: "s9") == ["deny", 0] &&
      hook("#{M}extract_metadata", agent_type: "doc-analysis", session: "s9") == [nil, 0] &&
      hook("#{M}verify_claim", agent_type: "doc-analysis", session: "s9") == [nil, 0])
logs = File.readlines(HOOK_LOG).map { |l| JSON.parse(l) }
check("hook ghi log mọi lệnh (#{logs.size} dòng) với agent, tool, decision, rule",
      logs.size == 17 && logs.all? { |e| e.key?("agent") && e.key?("decision") && e.key?("tool") })
check("log phân biệt luật: outside_allowlist / metadata_gate / unknown_agent",
      %w[outside_allowlist metadata_gate unknown_agent].all? { |r| logs.any? { |e| e["rule"] == r } })
check("hook không bao giờ thoát mã 2 (chặn bằng JSON deny, có lý do)",
      logs.select { |e| e["decision"] == "deny" }.all? { |e| e["reason"].to_s.size > 20 })

# ---------------------------------------------------------------- server
puts "\n== MCP server (JSON-RPC thật qua stdio) =="
SRV_LOG = File.join(TMP, "server.jsonl")
reqs = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "save_snippet", arguments: { url: "https://www.gso.gov.vn/bao-cao-lao-dong-2026.pdf", quote: "62% doanh nghiệp", location: "tr. 14" } } },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "verify_fact", arguments: { fact: "tỉ lệ là 62%", source_url: "https://www.gso.gov.vn/bao-cao-lao-dong-2026.pdf" } } },
  { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "verify_fact", arguments: { fact: "Hybrid làm tăng năng suất so với văn phòng", source_url: "x" } } },
  { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "load_document", arguments: { url: "http://169.254.169.254/latest" } } },
  { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "fetch_url", arguments: { url: "https://a.b" } } },
  { jsonrpc: "2.0", id: 8, method: "nope" }
]
out, = Open3.capture2({ "RESEARCH_LOG" => SRV_LOG }, "ruby", File.join(ROOT, "cli/research_mcp_server.rb"),
                      stdin_data: reqs.map { |r| JSON.generate(r) }.join("\n") + "\n")
res = out.lines.map { |l| JSON.parse(l) }.to_h { |r| [r["id"], r] }
check("initialize trả serverInfo research", res[1].dig("result", "serverInfo", "name") == "research")
check("notification không được trả lời", res.size == 8)
names = res[2].dig("result", "tools").map { |t| t["name"] }
check("tools/list: 14 tool (12 nghiệp vụ + review_output, request_revision), không có Agent",
      names.size == 14 && !names.include?("Agent") && names.include?("verify_fact"))
check("tools/list: mỗi tool có inputSchema object", res[2].dig("result", "tools").all? { |t| t.dig("inputSchema", "type") == "object" })
check("không có fetch_url trên server", !names.include?("fetch_url"))
check("verify_fact đơn giản thấy trích đoạn đã lưu trong cùng tiến trình",
      res[4].dig("result", "structuredContent", "verified") == true)
check("verify_fact nhận định phức tạp → isError + business (chuyển coordinator)",
      res[5].dig("result", "isError") == true && res[5].dig("result", "structuredContent", "errorCategory") == "business")
check("load_document http://169.254… → isError validation (chặn ngay ở bước https)",
      res[6].dig("result", "isError") == true && res[6].dig("result", "structuredContent", "errorCategory") == "validation")
check("tool không tồn tại → lỗi giao thức JSON-RPC -32602 (không phải isError)", res[7].dig("error", "code") == -32_602)
check("method lạ → -32601", res[8].dig("error", "code") == -32_601)
check("server log 4 lệnh thực thi", File.readlines(SRV_LOG).size == 4)

# ---------------------------------------------------------------- config
puts "\n== cấu hình CLI sinh từ tool_config.rb =="
cfg_dir = CliConfig.write_all(File.join(TMP, "cfg"))
agents = JSON.parse(File.read(File.join(cfg_dir, "agents.json")))
check("agents.json có 4 agent (coordinator + 3 subagent, tên gạch nối)",
      agents.keys.sort == %w[coordinator doc-analysis synthesis web-search])
exact = CliConfig::ROLE_TO_CLI.all? do |role, cli|
  agents[cli]["tools"] == ToolConfig.allowed_names(role).map { |n| n == "Agent" ? "Agent" : "mcp__research__#{n}" }
end
check("tools của từng agent = đúng tên mcp__research__<tool> của role", exact)
check("subagent có 4–5 tool, coordinator chỉ Agent + 2 tool điều phối",
      %w[web-search doc-analysis synthesis].all? { |a| (4..5).cover?(agents[a]["tools"].size) } &&
      agents["coordinator"]["tools"] == %w[Agent mcp__research__review_output mcp__research__request_revision])
check("subagent đặt omitClaudeMd + background false; mọi agent model haiku",
      %w[web-search doc-analysis synthesis].all? { |a| agents[a]["omitClaudeMd"] == true && agents[a]["background"] == false } &&
      agents.values.all? { |a| a["model"] == "haiku" })
check("không tool nào trùng giữa 3 subagent",
      %w[web-search doc-analysis synthesis].flat_map { |a| agents[a]["tools"] }.then { |l| l.size == l.uniq.size })
allowed = File.read(File.join(cfg_dir, "allowed_tools.txt")).split(",")
check("--allowedTools phủ mọi tool của mọi agent", agents.values.flat_map { |a| a["tools"] }.uniq.all? { |t| allowed.include?(t) })
settings = JSON.parse(File.read(File.join(cfg_dir, "settings.json")))
check("settings.json: PreToolUse matcher * gọi guard_hook.rb",
      settings.dig("hooks", "PreToolUse", 0, "matcher") == "*" &&
      settings.dig("hooks", "PreToolUse", 0, "hooks", 0, "command").include?("guard_hook.rb"))
mcp = JSON.parse(File.read(File.join(cfg_dir, "mcp.json")))
check("mcp.json: server research stdio, file server tồn tại",
      mcp.dig("mcpServers", "research", "type") == "stdio" && File.exist?(mcp.dig("mcpServers", "research", "args", 0)))
bad = CliConfig.agents(misuse: true)
check("cấu hình --misuse chỉ thêm search_web cho synthesis",
      bad["synthesis"][:tools].include?("mcp__research__search_web") && bad["web-search"][:tools] == agents["web-search"]["tools"])

# ---------------------------------------------------------------- audit trên log dựng tay
puts "\n== audit_cli.rb trên log dựng tay =="
def fake_dir(name, hook_rows, server_rows, ok_result: true)
  d = File.join(TMP, name)
  FileUtils.mkdir_p(d)
  File.write(File.join(d, "hook.jsonl"), hook_rows.map { |r| JSON.generate(r) }.join("\n"))
  File.write(File.join(d, "server.jsonl"), server_rows.map { |r| JSON.generate(r) }.join("\n"))
  File.write(File.join(d, "stream.jsonl"), JSON.generate(type: "result", is_error: !ok_result, subtype: "success"))
  d
end
row = ->(agent, role, tool, id = nil, decision: "pass", rule: nil) { { agent: agent, role: role, tool: tool, agent_id: id, decision: decision, rule: rule } }
srv = ->(tool) { { tool: tool, isError: false } }
good_h = [row["coordinator", "coordinator", "Agent"], row["doc-analysis", "doc_analysis", "extract_metadata", "d1"],
          row["synthesis", "synthesis", "verify_fact", "s1"], row["synthesis", "synthesis", "compile_report", "s1"]]
good_s = [srv["extract_metadata"], srv["verify_fact"], srv["compile_report"]]
r = audit(fake_dir("good", good_h, good_s))
check("log đúng → mọi kiểm tra đạt", r[:checks].all? { |c| c[:ok] })
r = audit(fake_dir("order", [row["doc-analysis", "doc_analysis", "summarize_content", "d1"]] + good_h, [srv["summarize_content"]] + good_s))
check("doc-analysis chạy summarize trước metadata → audit TRƯỢT", r[:checks].any? { |c| !c[:ok] && c[:name].include?("doc-analysis") })
r = audit(fake_dir("bypass", good_h, good_s + [srv["search_web"]]))
check("server thực thi lệnh không qua hook → audit TRƯỢT", r[:checks].any? { |c| !c[:ok] && c[:name].include?("qua hook") })
r = audit(fake_dir("viol", good_h + [row["synthesis", "synthesis", "search_web", "s1", decision: "deny", rule: "outside_allowlist"]], good_s))
check("có vi phạm bị chặn → chế độ thường TRƯỢT 'không có vi phạm'", r[:checks].any? { |c| !c[:ok] && c[:name] == "không có vi phạm" })
r = audit(fake_dir("viol2", good_h + [row["synthesis", "synthesis", "search_web", "s1", decision: "deny", rule: "outside_allowlist"]], good_s), misuse: true)
check("… và chế độ --misuse ĐẠT", r[:checks].all? { |c| c[:ok] })
r = audit(fake_dir("nohook", [], good_s))
check("không có log hook (hook không chạy) → audit TRƯỢT", r[:checks].any? { |c| !c[:ok] && c[:name].include?("có log hook") })

# ---------------------------------------------------------------- e2e với claude giả
puts "\n== end-to-end: run_cli.sh với `claude` GIẢ (kịch bản cố định) =="
env = { "PATH" => "#{File.join(ROOT, 'test/bin')}:#{ENV['PATH']}" }
out, st = Open3.capture2e(env, File.join(ROOT, "run_cli.sh"), "run")
check("run_cli.sh run → thoát 0, audit 10/10", st.success? && out.include?("10/10 đạt"))
check("log ghi rõ là claude GIẢ", out.include?("GIẢ"))
check("cổng extract_metadata chặn đúng 1 lệnh sai thứ tự", out.include?("cổng hook chặn 1 lệnh"))
out, st = Open3.capture2e(env, File.join(ROOT, "run_cli.sh"), "misuse")
check("run_cli.sh misuse → hook chặn synthesis→search_web, audit đạt", st.success? && out.include?("synthesis → search_web [outside_allowlist]"))
srv_misuse = File.readlines(File.join(ROOT, "logs/cli/misuse/server.jsonl")).map { |l| JSON.parse(l) }
check("search_web chỉ được thực thi 1 lần (của web-search), lệnh của synthesis không tới server",
      srv_misuse.count { |e| e["tool"] == "search_web" } == 1)
out, st = Open3.capture2e(env, "claude", "-p", "x", "--agent", "coordinator")
check("claude giả từ chối khi thiếu cờ bắt buộc (kiểm chính run_cli.sh truyền đủ cờ)", st.exitstatus == 2)

FileUtils.rm_rf(TMP)
puts "\n#{$pass} PASS, #{$fail} FAIL"
exit($fail.zero? ? 0 : 1)
