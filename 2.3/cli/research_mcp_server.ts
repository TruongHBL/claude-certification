// Bài 2.3 – bản CLI: MCP server stdio "research" phục vụ 12 tool nghiệp vụ + 2 tool điều phối.
//
// Định nghĩa tool lấy từ ../tool_config.ts, dữ liệu giả + logic tool lấy từ MockWorld trong
// ../multi_agent_run.ts (file đó có main guard nên import không chạy gì).
// Một tiến trình server phục vụ cả coordinator lẫn mọi subagent của cùng một lệnh `claude -p`
// (subagent dùng chung MCP server của phiên cha) → kho trích đoạn save_snippet dùng chung được.
//
// Server KHÔNG biết agent nào gọi; việc gán agent và kiểm allowlist do hook guard_hook.ts làm.
// Tool không tồn tại = lỗi giao thức JSON-RPC -32602 (lớp 1, bài 2.2), do lib/mcp_server.ts trả.
//
// Env: RESEARCH_LOG = file JSONL ghi mỗi tools/call được thực thi (tool, args, isError) – audit_cli.ts đọc.
import { appendFileSync } from "node:fs";
import { runServer, type ToolDef, type ToolHandler, type ToolResult } from "../../lib/mcp_server.ts";
import { AGENTS } from "../tool_config.ts";
import { MockWorld } from "../multi_agent_run.ts";

const LOG_PATH = process.env.RESEARCH_LOG;

// Tool "Agent" là built-in của Claude Code, không phục vụ qua MCP.
const seen = new Set<string>();
const TOOLS: ToolDef[] = Object.values(AGENTS)
  .flatMap((a) => a.tools)
  .filter((t) => t.name !== "Agent" && !seen.has(t.name) && seen.add(t.name))
  .map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema }));

const WORLD = new MockWorld();

function logCall(entry: Record<string, unknown>): void {
  if (LOG_PATH) appendFileSync(LOG_PATH, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\n");
}

function callTool(name: string, args: Record<string, unknown>): ToolResult {
  const [data, isErr] = WORLD.execute(name, args);
  logCall({ tool: name, args, isError: isErr });
  const result: ToolResult = { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  if (isErr) result.isError = true;
  return result;
}

const handlers: Record<string, ToolHandler> = Object.fromEntries(
  TOOLS.map((t) => [t.name, (args: Record<string, unknown>) => callTool(t.name, args)]),
);

runServer({ name: "research", tools: TOOLS, handlers });
