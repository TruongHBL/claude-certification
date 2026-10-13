// `claude` GIẢ cho bài 2.3 (bản CLI). KHÔNG gọi model. Đóng vai Claude Code theo KỊCH BẢN CỐ ĐỊNH để
// kiểm tra đầu-cuối: cờ của run_cli.sh, MCP server thật (stdio), hook thật (sh -c, JSON stdin), audit.
// Gọi qua wrapper test/bin/claude.
//
// Mô phỏng các hành vi của Claude Code mà bài dựa vào (đã đọc từ docs/types, CHƯA kiểm chứng bằng chạy thật):
//   - mỗi agent chỉ thấy tool trong agents.json[agent].tools; tool khác → "No such tool available" (không qua hook)
//   - hook PreToolUse chạy trước mọi lệnh gọi tool, nhận agent_id/agent_type khi ở subagent
//   - subagent dùng chung MCP server của phiên
// Việc chọn tool là do KỊCH BẢN dưới đây quyết định, không phải hành vi của Claude.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { McpClient } from "../../../lib/mcp_client.ts";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
function abortUsage(msg: string): never {
  console.error(`[claude giả] ${msg}`);
  process.exit(2);
}

const promptI = Math.max(argv.indexOf("-p"), argv.indexOf("--print"));
if (promptI < 0) abortUsage("thiếu -p");
const prompt = argv[promptI + 1];
for (const f of ["--agent", "--agents", "--mcp-config", "--settings", "--tools", "--allowedTools", "--permission-mode", "--output-format"]) {
  if (!flag(f)) abortUsage(`thiếu ${f}`);
}
if (!argv.includes("--strict-mcp-config")) abortUsage("thiếu --strict-mcp-config");
if (flag("--output-format") === "stream-json" && !argv.includes("--verbose")) abortUsage("stream-json cần --verbose");
if (flag("--permission-mode") !== "dontAsk") abortUsage("--permission-mode phải là dontAsk");
if (flag("--tools") !== "Agent") abortUsage("--tools phải chỉ có Agent");

interface AgentSpec { tools: string[] }
const agents = JSON.parse(readFileSync(flag("--agents")!, "utf8")) as Record<string, AgentSpec>;
const mainAgent = flag("--agent")!;
if (!Object.hasOwn(agents, mainAgent)) abortUsage(`--agent ${mainAgent} không có trong --agents`);
const allowed = flag("--allowedTools")!.split(/[,\s]+/);
const settings = JSON.parse(readFileSync(flag("--settings")!, "utf8"));
const hookCmds: string[] = (settings.hooks?.PreToolUse ?? [])
  .filter((m: any) => ["*", "", undefined, null].includes(m.matcher))
  .flatMap((m: any) => m.hooks.map((h: any) => h.command));
const mcp = JSON.parse(readFileSync(flag("--mcp-config")!, "utf8")).mcpServers as Record<string, any>;
if (Object.keys(mcp).join() !== "research") abortUsage("bài này cần đúng 1 MCP server 'research'");

const srv = mcp.research;
const SID = `fake-${randomBytes(4).toString("hex")}`;
const emit = (h: Record<string, unknown>) => process.stdout.write(JSON.stringify({ ...h, session_id: SID }) + "\n");

// ---- MCP client (server thật qua stdio) ----
const client = new McpClient(srv.command, srv.args, srv.env ?? {});
await client.initialize();
const mcpTools: string[] = (await client.request("tools/list")).result.tools.map((t: any) => `mcp__research__${t.name}`);

emit({
  type: "system", subtype: "init", fake: true, model: flag("--model"), agents: Object.keys(agents),
  tools: ["Agent", ...mcpTools].filter((t) => agents[mainAgent].tools.includes(t)),
  mcp_servers: [{ name: "research", status: "connected" }],
});

let turns = 0;
let seq = 0;
const nextId = () => `toolu_fake_${++seq}`;

/** Chạy hook thật. Trả [deny?, reason] */
function runHooks(toolName: string, input: unknown, agentName: string, agentId: string | null): [boolean, string | null] {
  const payload: Record<string, unknown> = {
    session_id: SID, transcript_path: "/dev/null", cwd: process.cwd(), hook_event_name: "PreToolUse",
    permission_mode: "dontAsk", tool_name: toolName, tool_input: input, agent_type: agentName,
  };
  if (agentId) payload.agent_id = agentId;
  for (const cmd of hookCmds) {
    const r = spawnSync("sh", ["-c", cmd], { input: JSON.stringify(payload), encoding: "utf8" });
    if (r.status === 2) return [true, `hook exit ${r.status}`];
    if (!r.stdout.trim()) continue;
    const o = JSON.parse(r.stdout);
    if (o.hookSpecificOutput?.permissionDecision === "deny") return [true, o.hookSpecificOutput.permissionDecisionReason];
  }
  return [false, null];
}

/** Thực hiện 1 lệnh gọi tool như Claude Code: kiểm agent có tool không → hook → quyền → thực thi. */
async function call(
  agentName: string, agentId: string | null, parent: string | null, short: string, input: Record<string, unknown>,
  sub?: (id: string) => Promise<string>,
): Promise<[string, boolean]> {
  const name = short === "Agent" ? "Agent" : `mcp__research__${short}`;
  const id = nextId();
  turns++;
  emit({
    type: "assistant", parent_tool_use_id: parent,
    message: { id: `msg_${id}`, role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] },
  });
  let text: string;
  let isErr: boolean;
  let hookDeny: [boolean, string | null];
  if (!agents[agentName].tools.includes(name)) {
    [text, isErr] = [`<tool_use_error>Error: No such tool available: ${name}</tool_use_error>`, true];
  } else if ((hookDeny = runHooks(name, input, agentName, agentId))[0]) {
    [text, isErr] = [String(hookDeny[1]), true];
  } else if (!allowed.includes(name)) {
    [text, isErr] = [`Permission to use ${name} has been denied (dontAsk).`, true];
  } else if (name === "Agent") {
    [text, isErr] = [await sub!(id), false];
  } else {
    const r = await client.callTool(short, input);
    [text, isErr] = r.error ? [r.error.message, true] : [r.result.content[0].text, r.result.isError === true];
  }
  emit({
    type: "user", parent_tool_use_id: parent,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: isErr }] },
  });
  return [text, isErr];
}

const GSO = "https://www.gso.gov.vn/bao-cao-lao-dong-2026.pdf";
const ILO = "https://www.ilo.org/hybrid-work-asia-2025.pdf";
const COMPLEX = "Hybrid làm tăng năng suất 4–7% so với làm toàn thời gian tại văn phòng ở Việt Nam";
const misuse = agents.synthesis?.tools.includes("mcp__research__search_web") ?? false;

type Call = [string, Record<string, unknown>];
const SCRIPTS: Record<string, Call[]> = {
  "web-search": [
    ["search_web", { query: "hybrid năng suất văn phòng Việt Nam 2026" }],
    ["load_document", { url: "https://www.gso.gov.vn/images/hybrid-chart.png" }],
    ["load_document", { url: GSO }],
    ["load_document", { url: ILO }],
    ["save_snippet", { url: GSO, quote: "62% doanh nghiệp văn phòng áp dụng hybrid", location: "tr. 14" }],
    ["save_snippet", { url: ILO, quote: "năng suất tự đánh giá tăng 4–7% với hybrid 2–3 ngày", location: "p. 31" }],
  ],
  "doc-analysis": [
    ["extract_data_points", { document_id: "doc-gso", topic: "hybrid" }], // cố ý sai thứ tự → cổng hook chặn
    ["extract_metadata", { document_id: "doc-gso" }],
    ["extract_data_points", { document_id: "doc-gso", topic: "hybrid" }],
    ["extract_metadata", { document_id: "doc-ilo" }],
    ["extract_data_points", { document_id: "doc-ilo", topic: "năng suất" }],
    ["summarize_content", { document_id: "doc-ilo" }],
  ],
  "doc-analysis-verify": [
    ["extract_metadata", { document_id: "doc-ilo" }],
    ["verify_claim", { claim: COMPLEX, document_ids: ["doc-gso", "doc-ilo"] }],
  ],
  synthesis: [
    ["verify_fact", { fact: "Tỉ lệ doanh nghiệp văn phòng áp dụng hybrid năm 2026 là 62%", source_url: GSO }],
    ["verify_fact", { fact: COMPLEX, source_url: ILO }],
    ...(misuse ? [["search_web", { query: "nguồn bổ sung hybrid" }] as Call] : []),
    ["format_citation", { author: "ILO", year: "2025", title: "Hybrid Work in Asia-Pacific 2025", url: ILO }],
    ["compile_report", {
      title: "Hybrid và năng suất văn phòng VN 2026",
      sections: [{ heading: "Mức độ phổ biến", body: "62% doanh nghiệp văn phòng áp dụng hybrid.", citations: [GSO] }],
      needs_coordinator_verification: [COMPLEX],
    }],
  ],
};

async function runSub(cliName: string, scriptKey: string, parent: string): Promise<string> {
  const agentId = `agent_${randomBytes(3).toString("hex")}`;
  for (const [short, input] of SCRIPTS[scriptKey]) await call(cliName, agentId, parent, short, input);
  return `[${cliName}] xong (kịch bản giả)`;
}

const coord: [string, string, string][] = [
  ["web-search", "web-search", `Tìm nguồn: ${prompt}`],
  ["doc-analysis", "doc-analysis", "Phân tích doc-gso, doc-ilo"],
  ["synthesis", "synthesis", "Viết báo cáo từ các số liệu đã có"],
  ["doc-analysis", "doc-analysis-verify", `Kiểm chứng: ${COMPLEX}`],
];
for (const [sub, key, p] of coord) {
  await call(mainAgent, null, null, "Agent", { subagent_type: sub, description: key, prompt: p }, (id) => runSub(sub, key, id));
}
await call(mainAgent, null, null, "review_output", { agent_type: "synthesis", verdict: "pass", reason: "đủ nguồn" });

client.close();
emit({
  type: "result", subtype: "success", is_error: false, num_turns: turns, total_cost_usd: 0.0,
  result: "[claude giả] Báo cáo: 62% doanh nghiệp áp dụng hybrid (GSO); mức tăng năng suất 4–7% chỉ là tự đánh giá (ILO).",
});
