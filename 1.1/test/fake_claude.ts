// CLAUDE GIẢ cho test bài 1.1 (bản CLI). KHÔNG gọi model.
// Kịch bản viết tay: lượt 1 gọi 2 web_search, lượt 2 gọi 2 calculator, lượt 3 end_turn.
// Tool được chạy THẬT qua MCP server (stdio) để kiểm tra server + parser đầu-cuối.
// Lượt 1 cố ý tách thành 2 dòng assistant cùng message.id (giống stream-json thật) để test việc gom.
import { appendFileSync, readFileSync } from "node:fs";
import { McpClient } from "../../lib/mcp_client.ts";

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_ARGV_LOG ?? "/dev/null", JSON.stringify(args) + "\n");
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const cfg = JSON.parse(readFileSync(opt("--mcp-config")!, "utf8"));
const srv = cfg.mcpServers.loop;
const mcp = new McpClient(srv.command, srv.args, srv.env ?? {});
await mcp.initialize();
const tools = (await mcp.request("tools/list")).result.tools as { name: string }[];

const out = (h: Record<string, unknown>) => console.log(JSON.stringify({ ...h, parent_tool_use_id: null }));
const noStop = !!process.env.FAKE_NO_STOP_REASON;
out({ type: "system", subtype: "init", tools: tools.map((t) => `mcp__loop__${t.name}`), model: "fake" });
const call = async (tid: string, name: string, input: Record<string, unknown>) => {
  const r = (await mcp.callTool(name, input)).result;
  return { type: "tool_result", tool_use_id: tid, content: r.content, is_error: !!r.isError };
};

// Lượt 1: 2 tool_use song song, tách 2 dòng cùng id; dòng đầu stop_reason null.
const u1 = { type: "tool_use", id: "toolu_a1", name: "mcp__loop__web_search", input: { query: "dân số Hà Nội 2024" } };
const u2 = { type: "tool_use", id: "toolu_a2", name: "mcp__loop__web_search", input: { query: "dân số TP. Hồ Chí Minh 2024" } };
out({ type: "assistant", message: { id: "msg_fake_1", content: [{ type: "text", text: "Mình tra dân số hai thành phố." }, u1], stop_reason: null } });
out({ type: "assistant", message: { id: "msg_fake_1", content: [u2], stop_reason: noStop ? null : "tool_use" } });
out({ type: "user", message: { content: [await call("toolu_a1", "web_search", u1.input), await call("toolu_a2", "web_search", u2.input)] } });
// Lượt 2: 2 calculator.
const c1 = { type: "tool_use", id: "toolu_b1", name: "mcp__loop__calculator", input: { expression: "8.7 + 9.5" } };
const c2 = { type: "tool_use", id: "toolu_b2", name: "mcp__loop__calculator", input: { expression: "(9.5 - 8.7) / 8.7 * 100" } };
out({ type: "assistant", message: { id: "msg_fake_2", content: [c1, c2], stop_reason: noStop ? null : "tool_use" } });
const results = [await call("toolu_b1", "calculator", c1.input)];
if (!process.env.FAKE_DROP_RESULT) results.push(await call("toolu_b2", "calculator", c2.input));
out({ type: "user", message: { content: results } });
// Lượt 3: kết thúc.
const answer = "(GIẢ) Tổng 18,2 triệu; HCM đông hơn khoảng 9,2%.";
out({ type: "assistant", message: { id: "msg_fake_3", content: [{ type: "text", text: answer }], stop_reason: noStop ? null : "end_turn" } });
out({ type: "result", subtype: "success", num_turns: 3, total_cost_usd: 0, result: answer });
mcp.close();
