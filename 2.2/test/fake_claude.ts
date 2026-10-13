// CLAUDE GIẢ cho test run_llm.sh bài 2.2 (test/bin/claude là wrapper bash gọi file này).
// KHÔNG gọi model: khởi chạy server thật từ --mcp-config, gọi đúng 1 tool theo luật viết tay rồi in stream-json.
// Chỉ để kiểm tra đường ống, không đo hành vi model.
import { readFileSync } from "node:fs";
import { McpClient } from "../../lib/mcp_client.ts";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const prompt = opt("-p") ?? "";
const srv = JSON.parse(readFileSync(opt("--mcp-config")!, "utf8")).mcpServers.support;

const client = new McpClient(srv.command, srv.args, srv.env);
await client.initialize();
const tools = (await client.request("tools/list")).result.tools as { name: string }[];
const id = prompt.match(/CUS-\d{4}/)?.[0] ?? prompt.match(/cus \d+/)?.[0];
const [name, input] = /hoàn/i.test(prompt)
  ? ["process_refund", { customer_id: id, amount: Number(prompt.match(/\d+(?= USD)/)?.[0] ?? 0) }]
  : ["get_customer", { customer_id: id }];
const res = (await client.callTool(name, input)).result;
client.close();

const out = (o: unknown) => console.log(JSON.stringify(o));
out({ type: "system", subtype: "init", tools: tools.map((t) => `mcp__support__${t.name}`) });
out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: `mcp__support__${name}`, input }] } });
out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: res.content, is_error: res.isError }] } });
out({ type: "result", subtype: "success", result: `(GIẢ) ${String(res.content[0].text).slice(0, 60)}`, total_cost_usd: 0 });
