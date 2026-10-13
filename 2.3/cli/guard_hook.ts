// Bài 2.3 – bản CLI: hook PreToolUse (matcher "*") thay cho tool_choice + audit của bản Messages API.
//
// Input (JSON trên stdin, theo BaseHookInput của Agent SDK 0.3.x):
//   tool_name, tool_input, session_id, agent_id (CHỈ có khi tool được gọi trong subagent),
//   agent_type (tên agent: có trong subagent, hoặc ở luồng chính khi chạy --agent coordinator).
//
// Hai luật:
//   1. Allowlist theo vai trò: tool ngoài bộ của agent → deny + ghi vi phạm.
//      (Lớp thứ 2: lớp thứ 1 là agents.tools. Hook bắt được khi agents.tools bị cấu hình nhầm.)
//   2. Cổng doc-analysis: chưa gọi extract_metadata trong subagent này → deny mọi tool khác của nó.
//      GẦN ĐÚNG với tool_choice forced: hook chỉ CHẶN lệnh sai rồi trả lý do, KHÔNG ÉP model gọi
//      extract_metadata. Model phải tự gọi lại; lượt đầu có thể là một lệnh bị chặn.
//
// Output: deny → JSON hookSpecificOutput.permissionDecision = "deny" (exit 0).
//         cho phép → không in gì (để luật quyền thường của phiên quyết định).
// Env: GUARD_LOG (JSONL), GUARD_STATE (thư mục lưu trạng thái cổng theo agent_id).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { allowedNames, type Role } from "../tool_config.ts";

const SERVER_PREFIX = "mcp__research__";
const CLI_TO_ROLE: Record<string, Role> = {
  coordinator: "coordinator", "web-search": "web_search", "doc-analysis": "doc_analysis", synthesis: "synthesis",
};

interface HookInput {
  session_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  agent_id?: string;
  agent_type?: string;
}

const now = () => new Date().toISOString();

function appendJsonl(path: string | undefined, entry: unknown): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  // appendFileSync dùng O_APPEND: mỗi dòng ngắn được ghi nguyên khối, an toàn khi nhiều hook chạy song song.
  appendFileSync(path, JSON.stringify(entry) + "\n");
}

function deny(reason: string): void {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }) + "\n");
}

/** Trả [role, cli_agent_name]. Luồng chính không có agent_id; với --agent coordinator thì agent_type = coordinator. */
function resolveAgent(input: HookInput): [Role | undefined, string] {
  const type = input.agent_type;
  if (!input.agent_id && (type === undefined || type === null || type === "coordinator")) return ["coordinator", type ?? "(main)"];
  return [type ? CLI_TO_ROLE[type] : undefined, String(type)];
}

// Cổng extract_metadata: trạng thái theo từng subagent (agent_id). Dự phòng khi thiếu agent_id: session + agent_type.
const gateKey = (input: HookInput) =>
  (input.agent_id ? input.agent_id : `${input.session_id}-${input.agent_type}`).replace(/[^\w.-]/g, "_");

const gatePassed = (dir: string | undefined, key: string) => !!dir && existsSync(join(dir, `${key}.metadata_done`));

function markGate(dir: string | undefined, key: string): void {
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.metadata_done`), now());
}

const input = JSON.parse(readFileSync(0, "utf8")) as HookInput;
const toolName = String(input.tool_name ?? "");
const tool = toolName.startsWith(SERVER_PREFIX) ? toolName.slice(SERVER_PREFIX.length) : toolName;
const [role, cliAgent] = resolveAgent(input);
const log = process.env.GUARD_LOG;
const state = process.env.GUARD_STATE;
const entry = {
  ts: now(), session_id: input.session_id, agent_id: input.agent_id, agent_type: input.agent_type,
  agent: cliAgent, role: role ?? null, tool, tool_input: input.tool_input,
};

let decision: "deny" | null = null;
let rule: string | null = null;
let reason: string | null = null;
if (role === undefined) {
  decision = "deny";
  rule = "unknown_agent";
  reason = `Agent '${cliAgent}' không có trong cấu hình bài 2.3; không cấp tool nào.`;
} else if (!allowedNames(role).includes(tool)) {
  decision = "deny";
  rule = "outside_allowlist";
  reason = `Tool '${tool}' không thuộc bộ tool của ${cliAgent} (${allowedNames(role).join(", ")}). ` +
    "Không thử lại; ghi việc này vào kết quả để coordinator giao đúng agent.";
} else if (role === "doc_analysis") {
  const key = gateKey(input);
  if (tool === "extract_metadata") {
    markGate(state, key);
  } else if (!gatePassed(state, key)) {
    decision = "deny";
    rule = "metadata_gate";
    reason = `Bước bắt buộc đầu tiên: gọi extract_metadata cho tài liệu trước khi ${tool}.`;
  }
}

appendJsonl(log, { ...entry, decision: decision ?? "pass", rule, reason });
if (decision === "deny" && reason) deny(reason);
process.exitCode = 0;
