// Kiểm thử bản CLI của bài 2.3. Chạy: node --experimental-strip-types test/cli.test.ts
//   hook   : THẬT – chạy cli/guard_hook.ts như Claude Code chạy (JSON trên stdin), đọc output + log
//   server : THẬT – bơm JSON-RPC vào cli/research_mcp_server.ts qua stdio
//   config : THẬT – agents.json / mcp.json / settings.json sinh từ tool_config.ts
//   audit  : THẬT – audit_cli.ts trên log dựng tay (cả log đúng lẫn log sai)
//   e2e    : `claude` GIẢ (test/bin/claude) – kịch bản cố định, không phải Claude
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, section, summary } from "../../lib/check.ts";
import { agents as cliAgents, ROLE_TO_CLI, writeAll } from "../cli/cli_config.ts";
import { audit } from "../audit_cli.ts";
import { allowedNames, type Role } from "../tool_config.ts";

const ROOT = join(import.meta.dirname, "..");
const NODE = [process.execPath, "--experimental-strip-types", "--no-warnings"];
const TMP = mkdtempSync(join(tmpdir(), "bai23cli-"));
const readJsonl = (p: string) => readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- hook
section("hook PreToolUse (guard_hook.ts, chạy thật)");
const HOOK_LOG = join(TMP, "hook.jsonl");
const STATE = join(TMP, "state");
function hook(tool: string, { agentType, agentId, session = "s1", input = {} }:
  { agentType?: string; agentId?: string; session?: string; input?: object } = {}): [string | null, number | null] {
  const payload: Record<string, unknown> = { session_id: session, hook_event_name: "PreToolUse", tool_name: tool, tool_input: input };
  if (agentType) payload.agent_type = agentType;
  if (agentId) payload.agent_id = agentId;
  const r = spawnSync(NODE[0], [...NODE.slice(1), join(ROOT, "cli/guard_hook.ts")], {
    input: JSON.stringify(payload), encoding: "utf8", env: { ...process.env, GUARD_LOG: HOOK_LOG, GUARD_STATE: STATE },
  });
  const dec = r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision ?? null : null;
  return [dec, r.status];
}
const M = "mcp__research__";
const PASS: [null, number] = [null, 0];
const DENY: ["deny", number] = ["deny", 0];
check("coordinator (luồng chính, --agent coordinator) gọi Agent → cho qua", eq(hook("Agent", { agentType: "coordinator" }), PASS));
check("luồng chính không có agent_type vẫn được coi là coordinator", eq(hook("Agent"), PASS));
check("coordinator gọi search_web → deny", eq(hook(`${M}search_web`, { agentType: "coordinator" }), DENY));
check("coordinator gọi review_output → cho qua", eq(hook(`${M}review_output`, { agentType: "coordinator" }), PASS));
check("web-search gọi load_document → cho qua", eq(hook(`${M}load_document`, { agentType: "web-search", agentId: "w1" }), PASS));
check("synthesis gọi search_web → deny", eq(hook(`${M}search_web`, { agentType: "synthesis", agentId: "s1" }), DENY));
check("synthesis gọi verify_fact (scoped) → cho qua", eq(hook(`${M}verify_fact`, { agentType: "synthesis", agentId: "s1" }), PASS));
check("agent lạ (general-purpose) → deny mọi tool", eq(hook(`${M}search_web`, { agentType: "general-purpose", agentId: "g1" }), DENY));
check("subagent gọi Agent (lồng) → deny", eq(hook("Agent", { agentType: "web-search", agentId: "w1" }), DENY));
check("doc-analysis: extract_data_points trước metadata → deny (cổng)",
  eq(hook(`${M}extract_data_points`, { agentType: "doc-analysis", agentId: "d1" }), DENY));
check("doc-analysis: extract_metadata → cho qua", eq(hook(`${M}extract_metadata`, { agentType: "doc-analysis", agentId: "d1" }), PASS));
check("doc-analysis: sau metadata, extract_data_points → cho qua",
  eq(hook(`${M}extract_data_points`, { agentType: "doc-analysis", agentId: "d1" }), PASS));
check("doc-analysis phiên mới (agent_id khác) → cổng đóng lại",
  eq(hook(`${M}summarize_content`, { agentType: "doc-analysis", agentId: "d2" }), DENY));
check("doc-analysis: tool ngoài bộ (compile_report) → deny dù đã qua cổng",
  eq(hook(`${M}compile_report`, { agentType: "doc-analysis", agentId: "d1" }), DENY));
check("dự phòng thiếu agent_id: cổng theo session + agent_type",
  eq(hook(`${M}verify_claim`, { agentType: "doc-analysis", session: "s9" }), DENY) &&
  eq(hook(`${M}extract_metadata`, { agentType: "doc-analysis", session: "s9" }), PASS) &&
  eq(hook(`${M}verify_claim`, { agentType: "doc-analysis", session: "s9" }), PASS));
const logs = readJsonl(HOOK_LOG);
check(`hook ghi log mọi lệnh (${logs.length} dòng) với agent, tool, decision, rule`,
  logs.length === 17 && logs.every((e) => "agent" in e && "decision" in e && "tool" in e));
check("log phân biệt luật: outside_allowlist / metadata_gate / unknown_agent",
  ["outside_allowlist", "metadata_gate", "unknown_agent"].every((r) => logs.some((e) => e.rule === r)));
check("hook không bao giờ thoát mã 2 (chặn bằng JSON deny, có lý do)",
  logs.filter((e) => e.decision === "deny").every((e) => String(e.reason ?? "").length > 20));

// ---------------------------------------------------------------- server
section("MCP server (JSON-RPC thật qua stdio)");
const SRV_LOG = join(TMP, "server.jsonl");
const GSO = "https://www.gso.gov.vn/bao-cao-lao-dong-2026.pdf";
const reqs = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "save_snippet", arguments: { url: GSO, quote: "62% doanh nghiệp", location: "tr. 14" } } },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "verify_fact", arguments: { fact: "tỉ lệ là 62%", source_url: GSO } } },
  { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "verify_fact", arguments: { fact: "Hybrid làm tăng năng suất so với văn phòng", source_url: "x" } } },
  { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "load_document", arguments: { url: "http://169.254.169.254/latest" } } },
  { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "fetch_url", arguments: { url: "https://a.b" } } },
  { jsonrpc: "2.0", id: 8, method: "nope" },
];
const srvOut = spawnSync(NODE[0], [...NODE.slice(1), join(ROOT, "cli/research_mcp_server.ts")], {
  input: reqs.map((r) => JSON.stringify(r)).join("\n") + "\n", encoding: "utf8", env: { ...process.env, RESEARCH_LOG: SRV_LOG },
}).stdout;
const res = new Map<number, any>(srvOut.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).map((r) => [r.id, r]));
check("initialize trả serverInfo research", res.get(1)?.result?.serverInfo?.name === "research");
check("notification không được trả lời", res.size === 8);
const tools: any[] = res.get(2)?.result?.tools ?? [];
const names = tools.map((t) => t.name);
check("tools/list: 14 tool (12 nghiệp vụ + review_output, request_revision), không có Agent",
  names.length === 14 && !names.includes("Agent") && names.includes("verify_fact"));
check("tools/list: mỗi tool có inputSchema object", tools.every((t) => t.inputSchema?.type === "object"));
check("không có fetch_url trên server", !names.includes("fetch_url"));
check("verify_fact đơn giản thấy trích đoạn đã lưu trong cùng tiến trình", res.get(4)?.result?.structuredContent?.verified === true);
check("verify_fact nhận định phức tạp → isError + business (chuyển coordinator)",
  res.get(5)?.result?.isError === true && res.get(5)?.result?.structuredContent?.errorCategory === "business");
check("load_document http://169.254… → isError validation (chặn ngay ở bước https)",
  res.get(6)?.result?.isError === true && res.get(6)?.result?.structuredContent?.errorCategory === "validation");
check("tool không tồn tại → lỗi giao thức JSON-RPC -32602 (không phải isError)", res.get(7)?.error?.code === -32602);
check("method lạ → -32601", res.get(8)?.error?.code === -32601);
check("server log 4 lệnh thực thi", readJsonl(SRV_LOG).length === 4);

// ---------------------------------------------------------------- config
section("cấu hình CLI sinh từ tool_config.ts");
const cfgDir = writeAll(join(TMP, "cfg"));
const agents = JSON.parse(readFileSync(join(cfgDir, "agents.json"), "utf8")) as Record<string, any>;
check("agents.json có 4 agent (coordinator + 3 subagent, tên gạch nối)",
  eq(Object.keys(agents).sort(), ["coordinator", "doc-analysis", "synthesis", "web-search"]));
const exact = (Object.entries(ROLE_TO_CLI) as [Role, string][]).every(([role, cli]) =>
  eq(agents[cli].tools, allowedNames(role).map((n) => (n === "Agent" ? "Agent" : `mcp__research__${n}`))));
check("tools của từng agent = đúng tên mcp__research__<tool> của role", exact);
const subs = ["web-search", "doc-analysis", "synthesis"];
check("subagent có 4–5 tool, coordinator chỉ Agent + 2 tool điều phối",
  subs.every((a) => agents[a].tools.length >= 4 && agents[a].tools.length <= 5) &&
  eq(agents.coordinator.tools, ["Agent", "mcp__research__review_output", "mcp__research__request_revision"]));
check("subagent đặt omitClaudeMd + background false; mọi agent model haiku",
  subs.every((a) => agents[a].omitClaudeMd === true && agents[a].background === false) &&
  Object.values(agents).every((a) => a.model === "haiku"));
const subTools = subs.flatMap((a) => agents[a].tools as string[]);
check("không tool nào trùng giữa 3 subagent", subTools.length === new Set(subTools).size);
const allowed = readFileSync(join(cfgDir, "allowed_tools.txt"), "utf8").split(",");
check("--allowedTools phủ mọi tool của mọi agent",
  [...new Set(Object.values(agents).flatMap((a) => a.tools as string[]))].every((t) => allowed.includes(t)));
const settings = JSON.parse(readFileSync(join(cfgDir, "settings.json"), "utf8"));
check("settings.json: PreToolUse matcher * gọi guard_hook.ts",
  settings.hooks?.PreToolUse?.[0]?.matcher === "*" && String(settings.hooks.PreToolUse[0].hooks[0].command).includes("guard_hook.ts"));
const mcp = JSON.parse(readFileSync(join(cfgDir, "mcp.json"), "utf8"));
const srvArgs: string[] = mcp.mcpServers?.research?.args ?? [];
check("mcp.json: server research stdio, file server tồn tại",
  mcp.mcpServers?.research?.type === "stdio" && existsSync(srvArgs[srvArgs.length - 1] ?? ""));
const bad = cliAgents({ misuse: true });
check("cấu hình --misuse chỉ thêm search_web cho synthesis",
  bad.synthesis.tools.includes("mcp__research__search_web") && eq(bad["web-search"].tools, agents["web-search"].tools));

// ---------------------------------------------------------------- audit trên log dựng tay
section("audit_cli.ts trên log dựng tay");
function fakeDir(name: string, hookRows: object[], serverRows: object[], okResult = true): string {
  const d = join(TMP, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "hook.jsonl"), hookRows.map((r) => JSON.stringify(r)).join("\n"));
  writeFileSync(join(d, "server.jsonl"), serverRows.map((r) => JSON.stringify(r)).join("\n"));
  writeFileSync(join(d, "stream.jsonl"), JSON.stringify({ type: "result", is_error: !okResult, subtype: "success" }));
  return d;
}
const row = (agent: string, role: string, tool: string, id: string | null = null, decision = "pass", rule: string | null = null) =>
  ({ agent, role, tool, agent_id: id, decision, rule });
const srv = (tool: string) => ({ tool, isError: false });
const goodH = [row("coordinator", "coordinator", "Agent"), row("doc-analysis", "doc_analysis", "extract_metadata", "d1"),
  row("synthesis", "synthesis", "verify_fact", "s1"), row("synthesis", "synthesis", "compile_report", "s1")];
const goodS = [srv("extract_metadata"), srv("verify_fact"), srv("compile_report")];
const violation = row("synthesis", "synthesis", "search_web", "s1", "deny", "outside_allowlist");
let r = audit(fakeDir("good", goodH, goodS));
check("log đúng → mọi kiểm tra đạt", r.checks.every((c) => c.ok));
r = audit(fakeDir("order", [row("doc-analysis", "doc_analysis", "summarize_content", "d1"), ...goodH], [srv("summarize_content"), ...goodS]));
check("doc-analysis chạy summarize trước metadata → audit TRƯỢT", r.checks.some((c) => !c.ok && c.name.includes("doc-analysis")));
r = audit(fakeDir("bypass", goodH, [...goodS, srv("search_web")]));
check("server thực thi lệnh không qua hook → audit TRƯỢT", r.checks.some((c) => !c.ok && c.name.includes("qua hook")));
r = audit(fakeDir("viol", [...goodH, violation], goodS));
check("có vi phạm bị chặn → chế độ thường TRƯỢT 'không có vi phạm'", r.checks.some((c) => !c.ok && c.name === "không có vi phạm"));
r = audit(fakeDir("viol2", [...goodH, violation], goodS), { misuse: true });
check("… và chế độ --misuse ĐẠT", r.checks.every((c) => c.ok));
r = audit(fakeDir("nohook", [], goodS));
check("không có log hook (hook không chạy) → audit TRƯỢT", r.checks.some((c) => !c.ok && c.name.includes("có log hook")));

// ---------------------------------------------------------------- e2e với claude giả
section("end-to-end: run_cli.sh với `claude` GIẢ (kịch bản cố định)");
const env = { ...process.env, PATH: `${join(ROOT, "test/bin")}:${process.env.PATH}` };
const sh = (cmd: string, args: string[]) => {
  const p = spawnSync(cmd, args, { env, encoding: "utf8" });
  return { out: p.stdout + p.stderr, status: p.status };
};
let run = sh(join(ROOT, "run_cli.sh"), ["run"]);
check("run_cli.sh run → thoát 0, audit 10/10", run.status === 0 && run.out.includes("10/10 đạt"));
check("log ghi rõ là claude GIẢ", run.out.includes("GIẢ"));
check("cổng extract_metadata chặn đúng 1 lệnh sai thứ tự", run.out.includes("cổng hook chặn 1 lệnh"));
run = sh(join(ROOT, "run_cli.sh"), ["misuse"]);
check("run_cli.sh misuse → hook chặn synthesis→search_web, audit đạt",
  run.status === 0 && run.out.includes("synthesis → search_web [outside_allowlist]"));
const srvMisuse = readJsonl(join(ROOT, "logs/cli/misuse/server.jsonl"));
check("search_web chỉ được thực thi 1 lần (của web-search), lệnh của synthesis không tới server",
  srvMisuse.filter((e) => e.tool === "search_web").length === 1);
run = sh("claude", ["-p", "x", "--agent", "coordinator"]);
check("claude giả từ chối khi thiếu cờ bắt buộc (kiểm chính run_cli.sh truyền đủ cờ)", run.status === 2);

rmSync(TMP, { recursive: true, force: true });
summary();
