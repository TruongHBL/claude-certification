// Bài 1.4 – bản CLI: MCP server "support" (stdio, JSON-RPC 2.0, dùng lib/mcp_server.ts).
//
// Cùng 4 tool, cùng dữ liệu giả và cùng logic với bản API (đều lấy từ support_tools.ts), nhưng chạy dưới
// Claude Code CLI (`claude -p --mcp-config …`) thay vì vòng lặp Messages API tự viết.
//
// PREREQUISITE GATE nằm trong CODE của server (handler process_refund), không nằm trong prompt:
//   chưa có get_customer trả verified: true trong phiên này → trả isError + BLOCKED, không thực thi.
// Trạng thái phiên (khách đã xác minh, ledger refund đã thực thi, handoff) ghi ra file STATE_FILE,
// vì mỗi lệnh `claude -p` khởi chạy server mới: một file state = một phiên hội thoại.
//
// Biến môi trường:
//   STATE_FILE=<file>    trạng thái phiên (JSON), đọc lại mỗi lần gọi tool
//   SUPPORT_LOG=<file>   mỗi tools/call ghi 1 dòng JSON: tool, arguments, kết quả, isError, blocked
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { runServer, textResult, type ToolHandler } from "../lib/mcp_server.ts";
import { TOOLS, ToolError, callTool, isTool, newState, type SessionState } from "./support_tools.ts";

const STATE_FILE = process.env.STATE_FILE;
const LOG_FILE = process.env.SUPPORT_LOG;

const loadState = (): SessionState =>
  STATE_FILE && existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as SessionState) : newState();

const saveState = (state: SessionState) => {
  if (STATE_FILE) writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

function logCall(entry: Record<string, unknown>) {
  if (LOG_FILE) appendFileSync(LOG_FILE, JSON.stringify({ ...entry, at: new Date().toISOString() }) + "\n");
}

// Lỗi thực thi tool → result có isError: true (Claude đọc được và tự xử lý), không phải JSON-RPC error.
const handler =
  (name: string): ToolHandler =>
  (args) => {
    const state = loadState();
    try {
      const out = callTool(state, name, args);
      saveState(state);
      logCall({ tool: name, arguments: args, isError: false, blocked: false, result: out });
      return textResult(out);
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      saveState(state);
      logCall({ tool: name, arguments: args, isError: true, blocked: e.blocked, result: e.message });
      return { content: [{ type: "text", text: e.message }], isError: true };
    }
  };

runServer({
  name: "support",
  tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })),
  handlers: Object.fromEntries(TOOLS.map((t) => [t.name, handler(t.name)])),
  // Tool lạ: lib trả lỗi giao thức JSON-RPC (-32602), tool không chạy; vẫn ghi log để bộ chấm thấy.
  onCall: (name, args) => {
    if (!isTool(name)) logCall({ tool: name, arguments: args, isError: true, blocked: false, result: "unknown_tool" });
  },
});
