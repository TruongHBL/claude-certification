// Bài 2.3 – bản CLI: sinh cấu hình cho `claude -p` từ ../tool_config.ts.
//
//   agents.json   → --agents   (mỗi agent: description, prompt, tools = đúng tên mcp__research__<tool> của role)
//   mcp.json      → --mcp-config + --strict-mcp-config
//   settings.json → --settings (hook PreToolUse guard_hook.ts cho mọi tool)
//
// Coordinator chạy làm agent của luồng chính (--agent coordinator) để bộ tool của luồng chính
// cũng bị giới hạn bằng trường tools (Agent + 2 tool điều phối), không thấy 12 tool nghiệp vụ.
//
// Tên agent trong Claude Code dùng gạch nối (web-search…); ánh xạ về khoá của tool_config ở CLI_TO_ROLE.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AGENTS, allowedNames, type Role } from "../tool_config.ts";
import { QUESTION, SYSTEM_PROMPTS } from "../multi_agent_run.ts";

export const SERVER = "research";
export const ROLE_TO_CLI: Record<Role, string> = {
  coordinator: "coordinator", web_search: "web-search", doc_analysis: "doc-analysis", synthesis: "synthesis",
};
export const CLI_TO_ROLE: Record<string, Role> = Object.fromEntries(
  Object.entries(ROLE_TO_CLI).map(([role, cli]) => [cli, role as Role]),
);
const MODEL = process.env.CLI_MODEL ?? "haiku";
const NODE_TS = "node --experimental-strip-types --no-warnings";

export const mcpName = (tool: string) => (tool === "Agent" ? "Agent" : `mcp__${SERVER}__${tool}`);

/** Bỏ tiền tố mcp__research__ → tên tool trong tool_config. */
export const shortName = (toolName: unknown) => String(toolName ?? "").replace(new RegExp(`^mcp__${SERVER}__`), "");

export const cliTools = (role: Role) => allowedNames(role).map(mcpName);

// Prompt subagent cho bản CLI: thêm tên agent kiểu gạch nối và nhắc ranh giới.
const CLI_PROMPTS: Partial<Record<Role, string>> = {
  coordinator: "Bạn là coordinator của hệ nghiên cứu. Giao việc bằng tool Agent với subagent_type " +
    "web-search (tìm nguồn) → doc-analysis (phân tích tài liệu) → synthesis (viết báo cáo). " +
    "Subagent không thấy hội thoại của bạn: truyền đủ câu hỏi, url, document_id, số liệu trong prompt. " +
    "Nhận định synthesis để trong needs_coordinator_verification là kiểm chứng phức tạp: giao " +
    "doc-analysis dùng verify_claim. Bạn KHÔNG tự tìm kiếm hay phân tích. Duyệt kết quả bằng " +
    "review_output rồi trả lời người dùng bằng tiếng Việt.",
};

export function agentPrompt(role: Role): string {
  const base = CLI_PROMPTS[role] ?? SYSTEM_PROMPTS[role];
  return `${base}\nVai trò: ${AGENTS[role].role}\n` +
    "Chỉ dùng các tool được cấp cho bạn. Nếu cần việc ngoài vai trò, ghi rõ trong kết quả để coordinator xử lý.";
}

const DESCRIPTIONS: Record<Role, string> = {
  coordinator: "Điều phối hệ nghiên cứu: giao việc cho web-search, doc-analysis, synthesis và duyệt kết quả.",
  web_search: "Tìm nguồn trên web, tải tài liệu (chỉ tài liệu, qua load_document) và lưu trích đoạn kèm nguồn.",
  doc_analysis: "Phân tích tài liệu đã tải: metadata (luôn trước tiên), số liệu, tóm tắt, kiểm chứng đầy đủ nhiều nguồn.",
  synthesis: "Viết báo cáo cuối từ kết quả đã có; tra dữ kiện đơn giản một nguồn bằng verify_fact.",
};

export interface CliAgentSpec {
  description: string;
  prompt: string;
  tools: string[];
  model: string;
  omitClaudeMd?: boolean;
  background?: boolean;
}

// misuse: true → CỐ Ý cấu hình sai (cấp search_web cho synthesis + prompt xúi tìm thêm nguồn)
// để chứng minh lớp hook audit chặn được khi lớp agents.tools bị cấu hình nhầm.
export function agents({ misuse = false } = {}): Record<string, CliAgentSpec> {
  return Object.fromEntries((Object.entries(ROLE_TO_CLI) as [Role, string][]).map(([role, cli]) => {
    let tools = cliTools(role);
    let prompt = agentPrompt(role);
    if (misuse && role === "synthesis") {
      tools = [...tools, mcpName("search_web")];
      prompt += "\n(DEMO CẤU HÌNH SAI) Trước khi viết báo cáo, hãy gọi search_web để tìm thêm một nguồn mới.";
    }
    const spec: CliAgentSpec = { description: DESCRIPTIONS[role], prompt, tools, model: MODEL };
    // Subagent nhận mọi thứ qua prompt giao việc (bài 1.3) → bỏ CLAUDE.md của user cho gọn và sạch.
    if (role !== "coordinator") {
      spec.omitClaudeMd = true;
      spec.background = false;
    }
    return [cli, spec];
  }));
}

export function mcpConfig({ serverLog }: { serverLog: string }) {
  return {
    mcpServers: {
      [SERVER]: {
        type: "stdio", command: "node",
        args: ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "research_mcp_server.ts")],
        env: { RESEARCH_LOG: serverLog },
      },
    },
  };
}

export function settings({ hookLog, stateDir }: { hookLog: string; stateDir: string }) {
  const cmd = `GUARD_LOG='${hookLog}' GUARD_STATE='${stateDir}' ${NODE_TS} '${join(import.meta.dirname, "guard_hook.ts")}'`;
  return { hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: cmd, timeout: 10 }] }] } };
}

export const TOOLS_ALL: string[] = [...new Set(Object.values(AGENTS).flatMap((a) => a.tools.map((t) => t.name)))]
  .filter((n) => n !== "Agent");

// Toàn bộ tool phải nằm trong --allowedTools (permission-mode dontAsk từ chối mọi tool không liệt kê).
// Đây là lớp QUYỀN của cả phiên; lớp phân vai là agents.tools + hook.
export const allowedTools = (): string[] => [...new Set(["Agent", ...TOOLS_ALL.map(mcpName)])];

export function writeAll(dir: string, { misuse = false } = {}): string {
  mkdirSync(dir, { recursive: true });
  const files: Record<string, unknown> = {
    "agents.json": agents({ misuse }),
    "mcp.json": mcpConfig({ serverLog: join(dir, "server.jsonl") }),
    "settings.json": settings({ hookLog: join(dir, "hook.jsonl"), stateDir: join(dir, "state") }),
  };
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(data, null, 2));
  writeFileSync(join(dir, "allowed_tools.txt"), allowedTools().join(","));
  writeFileSync(join(dir, "question.txt"), QUESTION);
  return dir;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const dir = argv.find((a) => !a.startsWith("--"));
  if (!dir) {
    console.error("Dùng: node --experimental-strip-types cli_config.ts <thư_mục_ra> [--misuse]");
    process.exit(1);
  }
  console.log(writeAll(resolve(dir), { misuse: argv.includes("--misuse") }));
}
