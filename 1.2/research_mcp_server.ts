#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Bài 1.2 – bản CLI: MCP server "research" (stdio, JSON-RPC 2.0, dùng lib/mcp_server.ts).
//
// Một tool `search` GIẢ LẬP thay cho server tool web_search của bản API (tránh phí tìm kiếm và để
// kết quả lặp lại được). Mỗi kết quả có nguồn, để kiểm tra coordinator có chuyển nguồn sang
// subagent phân tích không.
// RESEARCH_LOG=<file> : mỗi tools/call ghi 1 dòng JSON.

import { appendFileSync } from "node:fs";
import { runServer, type ToolResult } from "../lib/mcp_server.ts";

const LOG_FILE = process.env.RESEARCH_LOG;

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function fakeSearch(query: string): string {
  const s = slug(query) || "topic";
  return (
    `[MOCK] 3 kết quả cho '${query}':\n` +
    `- Tổng quan về ${query} (nguồn: https://example.com/${s}/overview)\n` +
    `- Số liệu gần đây về ${query} (nguồn: https://example.com/${s}/stats)\n` +
    `- Thách thức và triển vọng của ${query} (nguồn: https://example.com/${s}/outlook)`
  );
}

const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

runServer({
  name: "research",
  tools: [
    {
      name: "search",
      description:
        "Tìm thông tin về MỘT nhánh con của chủ đề nghiên cứu. Trả về 3 kết quả ngắn, mỗi kết quả kèm URL nguồn. " +
        "Chỉ dành cho subagent tìm kiếm.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Câu truy vấn, vd 'solar photovoltaic 2026'" } },
        required: ["query"],
      },
    },
  ],
  onCall: (name, args) => {
    if (LOG_FILE) appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), tool: name, arguments: args }) + "\n");
  },
  handlers: {
    search: (args) => {
      const q = String(args.query ?? "").trim();
      return q ? text(fakeSearch(q)) : text("Lỗi: query rỗng", true);
    },
  },
});
