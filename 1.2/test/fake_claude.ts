// CLAUDE GIẢ cho test bài 1.2 (bản CLI). KHÔNG gọi model.
// Kịch bản viết tay mô phỏng stream-json của coordinator + subagent:
//   lượt 1: 5 search-agent song song (mỗi cái gọi search THẬT qua MCP server)
//   lượt 2: 5 analysis-agent song song, prompt có dán kết quả search
//   lượt 3: synthesis-agent; lượt 4: end_turn
// FAKE_MISUSE=nested : analysis-agent đầu tiên tự spawn search-agent (vi phạm hub-and-spoke)
// FAKE_MISUSE=search : analysis-agent đầu tiên tự gọi search (vi phạm phạm vi tool)
import { appendFileSync, readFileSync } from "node:fs";
import { McpClient } from "../../lib/mcp_client.ts";

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_ARGV_LOG ?? "/dev/null", JSON.stringify(args) + "\n");
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const agents = JSON.parse(readFileSync(opt("--agents")!, "utf8"));
if (!["search-agent", "analysis-agent", "synthesis-agent"].every((a) => a in agents)) {
  console.error("thiếu agent");
  process.exit(1);
}
const srv = JSON.parse(readFileSync(opt("--mcp-config")!, "utf8")).mcpServers.research;
const topic = (opt("-p") ?? "").replace("Chủ đề nghiên cứu: ", "");
const misuse = process.env.FAKE_MISUSE;

const mcp = new McpClient(srv.command, srv.args, srv.env ?? {});
await mcp.initialize();
await mcp.request("tools/list");

const out = (h: Record<string, unknown>, parent: string | null = null) =>
  console.log(JSON.stringify({ ...h, parent_tool_use_id: parent }));
let tid = 0;
const nid = () => `toolu_${++tid}`;
out({ type: "system", subtype: "init", tools: ["Task", "mcp__research__search"], agents: Object.keys(agents), model: "fake" });

async function searchIn(parent: string, q: string): Promise<string> {
  const u = nid();
  out({ type: "assistant", message: { id: `msg_${u}`, content: [{ type: "tool_use", id: u, name: "mcp__research__search", input: { query: q } }], stop_reason: "tool_use" } }, parent);
  const text = (await mcp.callTool("search", { query: q })).result.content[0].text as string;
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: u, content: text }] } }, parent);
  return text;
}

type Spec = [type: string, description: string, prompt: string];
async function spawnRound(mid: string, specs: Spec[], body: (id: string, i: number) => Promise<string>): Promise<string[]> {
  const ids = specs.map(() => nid());
  const blocks = specs.map(([t, d, p], i) => ({ type: "tool_use", id: ids[i], name: "Agent", input: { subagent_type: t, description: d, prompt: p } }));
  out({ type: "assistant", message: { id: mid, content: blocks, stop_reason: "tool_use" } });
  const results: string[] = [];
  for (let i = 0; i < specs.length; i++) results.push(await body(ids[i]!, i));
  out({ type: "user", message: { content: ids.map((id, i) => ({ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: results[i] }] })) } });
  return results;
}

const subs = ["solar photovoltaic", "wind power", "hydropower", "geothermal energy", "energy storage"];
const found = await spawnRound(
  "msg_coord_1",
  subs.map((s): Spec => ["search-agent", `Tìm: ${s}`, `Bối cảnh: báo cáo về '${topic}'. Nhánh: '${s}'. Ranh giới: chỉ viết về '${s}'. Output: 5–8 gạch đầu dòng kèm URL.`]),
  async (id, i) => {
    const text = await searchIn(id, `${subs[i]} 2026`);
    out({ type: "assistant", message: { id: `msg_s${id}`, content: [{ type: "text", text: `(GIẢ) tóm tắt ${subs[i]}` }], stop_reason: "end_turn" } }, id);
    return text;
  },
);
const sections = await spawnRound(
  "msg_coord_2",
  subs.map((s, i): Spec => ["analysis-agent", `Phân tích: ${s}`, `Báo cáo về '${topic}', phần '${s}'. Dữ liệu (chỉ dùng dữ liệu này):\n${found[i]}\nOutput: 1 đoạn hiện trạng/ưu/hạn chế/triển vọng.`]),
  async (id, i) => {
    if (i === 0 && misuse === "nested") {
      const u = nid();
      out({ type: "assistant", message: { id: `msg_${u}`, content: [{ type: "tool_use", id: u, name: "Agent", input: { subagent_type: "search-agent", description: "tự tìm thêm", prompt: "tìm thêm" } }], stop_reason: "tool_use" } }, id);
    } else if (i === 0 && misuse === "search") {
      await searchIn(id, `${subs[i]} thêm`);
    }
    out({ type: "assistant", message: { id: `msg_a${id}`, content: [{ type: "text", text: `(GIẢ) phân tích ${subs[i]}` }], stop_reason: "end_turn" } }, id);
    return `(GIẢ) Phân tích ${subs[i]} … nguồn https://example.com/${subs[i]!.replaceAll(" ", "-")}/overview`;
  },
);
const report = await spawnRound(
  "msg_coord_3",
  [["synthesis-agent", "Viết báo cáo cuối", `Viết báo cáo về '${topic}' từ các phần:\n${sections.join("\n")}`]],
  async (id) => {
    out({ type: "assistant", message: { id: `msg_y${id}`, content: [{ type: "text", text: "(GIẢ) báo cáo" }], stop_reason: "end_turn" } }, id);
    return `(GIẢ) # Báo cáo ${topic}\n${sections.join("\n")}`;
  },
);
out({ type: "assistant", message: { id: "msg_coord_4", content: [{ type: "text", text: report[0] }], stop_reason: "end_turn" } });
out({ type: "result", subtype: "success", num_turns: 4, total_cost_usd: 0, result: report[0] });
mcp.close();
