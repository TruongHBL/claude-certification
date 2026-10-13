#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Bài 1.1 – bản CLI: MCP server "loop" (stdio, JSON-RPC 2.0, dùng lib/mcp_server.ts).
//
// Hai tool GIỐNG HỆT bản API (dùng chung tools.ts): web_search (dữ liệu giả lập) và calculator.
// Ở bản API, chính code của mình chạy tool trong vòng lặp. Ở bản CLI, Claude Code chạy vòng lặp
// và gọi sang server này qua MCP; server chỉ thực thi tool.
// LOOP_LOG=<file> : mỗi tools/call ghi 1 dòng JSON (tool, arguments, kết quả, isError).

import { appendFileSync } from "node:fs";
import { runServer, type ToolHandler, type ToolResult } from "../lib/mcp_server.ts";
import { TOOL_SPECS, runTool } from "./tools.ts";

const LOG_FILE = process.env.LOOP_LOG;

const handler =
  (name: string): ToolHandler =>
  (args) => {
    const [out, err] = runTool(name, args); // lỗi thực thi → isError để Claude tự sửa input
    if (LOG_FILE) {
      appendFileSync(
        LOG_FILE,
        JSON.stringify({ at: new Date().toISOString(), tool: name, arguments: args, output: out, isError: err }) + "\n",
      );
    }
    const r: ToolResult = { content: [{ type: "text", text: out }] };
    if (err) r.isError = true;
    return r;
  };

runServer({
  name: "loop",
  tools: TOOL_SPECS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })),
  handlers: Object.fromEntries(TOOL_SPECS.map((t) => [t.name, handler(t.name)])),
});
