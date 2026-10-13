// CLAUDE GIẢ (logic). test/bin/claude là wrapper bash gọi file này; node chỉ strip type cho file đuôi .ts.
// CLAUDE GIẢ cho test bài 2.1. KHÔNG gọi model. Chọn tool bằng heuristic GIẢ ĐỊNH để kiểm tra pipeline.
// Khởi chạy MCP server thật theo --mcp-config, gọi tools/list rồi tools/call, in stream-json như CLI.
import { appendFileSync, readFileSync } from "node:fs";
import { McpClient } from "../../lib/mcp_client.ts";

const args = process.argv.slice(2);
if (process.env.FAKE_ARGV_LOG) appendFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify(args) + "\n");
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const prompt = opt("-p") ?? "";
const sys = opt("--system-prompt") ?? "";
const cfg = JSON.parse(readFileSync(opt("--mcp-config")!, "utf8"));
const srv = cfg.mcpServers.shop as { command: string; args: string[]; env: Record<string, string> };

const client = new McpClient(srv.command, srv.args, srv.env);
await client.initialize();
const tools = (await client.request("tools/list")).result.tools as { name: string; description: string }[];
const vague = tools.every((t) => t.description.length < 60);
const hasOrderId = /#\d{5}|GHN-|GHTK-/.test(prompt);
const name =
  sys.includes("Luôn kiểm tra thông tin khách hàng") && prompt.includes("khách") ? "get_customer"
  : vague ? (/khách|địa chỉ|Lan/.test(prompt) ? "get_customer" : "lookup_order")
  : hasOrderId ? "lookup_order" : "get_customer";

let input: Record<string, string>;
if (vague) input = { query: prompt };
else if (hasOrderId && name === "lookup_order") {
  const order = prompt.match(/#\d{5}/)?.[0];
  input = order ? { order_number: order } : { tracking_id: prompt.match(/(GHN|GHTK)-\d+/)?.[0] ?? "" };
} else {
  input = Object.fromEntries(
    ([["email", /\S+@\S+\.vn/], ["phone", /0\d{9}/], ["customer_id", /CUS-\d{4}/]] as const)
      .flatMap(([k, re]) => { const m = prompt.match(re)?.[0]; return m ? [[k, m]] : []; }),
  );
}
const res = await client.callTool(name, input);
client.close();

const out = (o: unknown) => console.log(JSON.stringify(o));
out({ type: "system", subtype: "init", tools: tools.map((t) => `mcp__shop__${t.name}`) });
out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: `mcp__shop__${name}`, input }] } });
out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: res.result?.content }] } });
out({ type: "result", subtype: "success", result: "(GIẢ) đã trả lời", total_cost_usd: 0 });
