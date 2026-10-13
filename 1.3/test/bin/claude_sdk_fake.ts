// CLAUDE GIẢ nói giao thức stream-json của Agent SDK, để test run_cli.sh / bai_1_3_context_passing.ts.
// KHÔNG gọi model. Luồng coordinator → 2 subagent song song → synthesizer là KỊCH BẢN CỐ ĐỊNH (GIẢ ĐỊNH).
// Cái được kiểm tra THẬT: SDK spawn đúng binary (CLAUDE_BIN), env không có ANTHROPIC_API_KEY, SDK gửi
// định nghĩa agents + JSON schema, và code verify() của bài đọc đúng stream message thật từ SDK.
// Gọi qua wrapper bash `claude-sdk-fake` (SDK spawn file thực thi; Node chỉ strip type cho file .ts).
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
if (argv[0] === "auth" && argv[1] === "status") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "fake" }));
  process.exit(0);
}
const LOG = process.env.FAKE_SDK_LOG;
const log = (h: unknown) => LOG && appendFileSync(LOG, JSON.stringify(h) + "\n");
const out = (h: unknown) => process.stdout.write(JSON.stringify(h) + "\n");
log({ argv, has_api_key: "ANTHROPIC_API_KEY" in process.env, self: process.env.FAKE_SELF ?? process.argv[1] });

const S = randomUUID();
const asst = (id: string, block: unknown, parent: string | null = null) =>
  out({ type: "assistant", session_id: S, parent_tool_use_id: parent, message: { id, role: "assistant", content: [block] } });
const resultFor = (tid: string, text: string, parent: string | null = null) =>
  out({ type: "user", session_id: S, parent_tool_use_id: parent, message: { role: "user", content: [{ type: "tool_result", tool_use_id: tid, content: text }] } });
const agent = (id: string, type: string, prompt: string) => ({ type: "tool_use", id, name: "Agent", input: { description: type, subagent_type: type, prompt } });

const FINDINGS = [
  { id: "W1", claim: "Làm từ xa tăng năng suất cá nhân ở tác vụ tập trung", analysis: "Phù hợp code/review", source_type: "web",
    source_url: "https://example.org/study-2025", document_name: null, page_number: null, confidence: "medium" },
  { id: "D1", claim: "68% nhân viên thấy focus time tăng khi ở nhà", analysis: "Khớp W1", source_type: "document",
    source_url: null, document_name: "khao-sat-noi-bo-2026.md", page_number: 2, confidence: "high" },
];
const REPORT = { summary: "(GIẢ) Hybrid giúp tập trung hơn.", claims: [
  { statement: "Làm ở nhà giúp tập trung hơn", finding_ids: ["W1", "D1"], citation: "https://example.org/study-2025; khao-sat-noi-bo-2026.md, tr. 2" },
] };

const rl = createInterface({ input: process.stdin });
for await (const l of rl) {
  if (!l.trim()) continue;
  const m = JSON.parse(l);
  if (m.type === "control_request") {
    const req = m.request ?? {};
    if (req.subtype === "initialize") log({ initialize: { agents: Object.keys(req.agents ?? {}), has_json_schema: req.jsonSchema != null } });
    out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
  } else if (m.type === "user") {
    out({ type: "system", subtype: "init", session_id: S, model: "fake", tools: ["Task", "WebSearch", "WebFetch", "Read", "Grep", "Glob"] });
    // 2 Agent call trong CÙNG response msg_1 → song song
    asst("msg_1", { type: "text", text: "(GIẢ) Giao song song cho 2 subagent." });
    asst("msg_1", agent("tu_w", "web-researcher", "Câu hỏi: ... Trả JSON findings."));
    asst("msg_1", agent("tu_d", "doc-analyst", "Câu hỏi: ... Chỉ đọc bai_1_3_docs."));
    asst("sub_w", { type: "tool_use", id: "tu_ws", name: "WebSearch", input: { query: "hybrid productivity" } }, "tu_w");
    resultFor("tu_w", JSON.stringify([FINDINGS[0]]));
    resultFor("tu_d", JSON.stringify([FINDINGS[1]]));
    asst("msg_2", agent("tu_s", "synthesizer", `Câu hỏi...\n<findings>${JSON.stringify(FINDINGS)}</findings>`));
    resultFor("tu_s", JSON.stringify(REPORT));
    out({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(REPORT), structured_output: REPORT,
      session_id: S, num_turns: 3, duration_ms: 1, duration_api_ms: 0, total_cost_usd: 0, usage: {}, uuid: randomUUID() });
    break;
  }
}
rl.close();
