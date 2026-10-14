// CLAUDE GIẢ cho test bài 2.4. KHÔNG gọi model.
//   - `claude mcp …` (setup_user_scope.sh): chỉ ghi argv vào FAKE_ARGV_LOG, không sửa config nào.
//   - `claude -p …` (run_cli.sh): khởi chạy MCP server thật theo --mcp-config, đọc resources/list và tools/list,
//     rồi chọn tool bằng heuristic GIẢ ĐỊNH: mô tả MCP sơ sài → dùng Grep; mô tả đầy đủ → đọc resource + gọi tool MCP.
import { appendFileSync, readFileSync } from "node:fs";
import { McpClient } from "../../lib/mcp_client.ts";

const args = process.argv.slice(2);
if (process.env.FAKE_ARGV_LOG) appendFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify(args) + "\n");
if (args[0] === "mcp") {
  console.log(`(GIẢ) claude ${args.join(" ")}`);
  process.exit(0);
}

const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const prompt = opt("-p") ?? "";
const cfg = JSON.parse(readFileSync(opt("--mcp-config")!, "utf8"));
const srv = cfg.mcpServers["crm-db"] as { command: string; args: string[]; env: Record<string, string> };

const client = new McpClient(srv.command, srv.args, srv.env);
await client.initialize();
const tools = (await client.request("tools/list")).result.tools as { name: string; description: string }[];
const sparse = tools.every((t) => t.description.length < 40);
const out = (o: unknown) => console.log(JSON.stringify(o));
out({ type: "system", subtype: "init", tools: ["Read", "Grep", "Glob", ...tools.map((t) => `mcp__crm-db__${t.name}`)] });

let n = 0;
const use = (name: string, input: unknown, content: unknown) => {
  const id = `t${++n}`;
  out({ type: "assistant", message: { id: `m${n}`, content: [{ type: "tool_use", id, name, input }] } });
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });
};

if (sparse) {
  // Mô tả 1 câu thua Grep: đi lục mã nguồn trước (không tìm thấy dữ liệu), rồi mới thử tool MCP.
  use("Grep", { pattern: "favorites|matching_projects" }, "(GIẢ) không có kết quả");
  use("Glob", { pattern: "**/*.sql" }, "(GIẢ) không có file");
}
if (/bảng|cột/.test(prompt)) {
  const r = await client.request("resources/read", { uri: "db://schema/main" });
  use("ReadMcpResourceTool", { server: "crm-db", uri: "db://schema/main" }, r.result?.contents?.[0]?.text?.slice(0, 80));
} else {
  const r = await client.callTool("query_matching_projects", { trade: "điện", status: "open", min_budget_jpy: 1_000_000 });
  use("mcp__crm-db__query_matching_projects", { trade: "điện", status: "open", min_budget_jpy: 1_000_000 }, r.result?.content);
}
client.close();
out({ type: "result", subtype: "success", result: "(GIẢ) đã trả lời", total_cost_usd: 0 });
