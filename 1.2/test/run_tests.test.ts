// Test bài 1.2: bản API + bản proxy với transport GIẢ, bản CLI với `claude` GIẢ (test/bin/). Không gọi model.
//   node --experimental-strip-types test/run_tests.test.ts

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, section, summary } from "../../lib/check.ts";
import { McpClient } from "../../lib/mcp_client.ts";
import type { MessagesRequest, MessagesResponse } from "../../lib/anthropic.ts";
import { hub } from "../bai_1_2_hub_and_spoke.ts";
import { proxyHub, type ChatFn } from "../bai_1_2_hub_and_spoke_proxy.ts";

const ROOT = join(import.meta.dirname, "..");
const BIN = join(import.meta.dirname, "bin");
const quiet = () => {};

// ---- 1. agents.json ----
section("agents.json");
const agents = JSON.parse(readFileSync(join(ROOT, "agents.json"), "utf8"));
check("agents.json: đủ search/analysis/synthesis",
  JSON.stringify(Object.keys(agents).sort()) === '["analysis-agent","search-agent","synthesis-agent"]');
check("agents.json: search-agent chỉ có tool search", JSON.stringify(agents["search-agent"].tools) === '["mcp__research__search"]');
check("agents.json: analysis/synthesis cấm Agent, Task và search",
  ["analysis-agent", "synthesis-agent"].every((a) =>
    ["Agent", "Task", "mcp__research__search"].every((t) => agents[a].disallowedTools.includes(t))));
check("agents.json: mọi agent có description + prompt",
  Object.values(agents).every((a: any) => String(a.description).length > 20 && String(a.prompt).length > 20));

// ---- 2. MCP server ----
section("MCP server");
{
  const d = mkdtempSync(join(tmpdir(), "t12-"));
  const log = join(d, "t.log");
  const c = McpClient.forTsServer(join(ROOT, "research_mcp_server.ts"), { RESEARCH_LOG: log });
  await c.initialize();
  const list = await c.request("tools/list");
  const r3 = await c.callTool("search", { query: "wind power" });
  const r4 = await c.callTool("search", { query: " " });
  const r5 = await c.callTool("fetch", {});
  const r6 = await c.request("x/y");
  c.close();
  check("server: tools/list = [search]", JSON.stringify(list.result.tools.map((t: any) => t.name)) === '["search"]');
  check("server: search trả 3 kết quả có URL", r3.result.content[0].text.split("https://example.com/wind-power").length - 1 === 3);
  check("server: query rỗng → isError", r4.result.isError === true);
  check("server: tool lạ → lỗi giao thức -32602", r5.error?.code === -32602);
  check("server: method lạ → -32601", r6.error?.code === -32601);
  check("server: ghi log 3 lần", readFileSync(log, "utf8").trim().split("\n").length === 3);
  rmSync(d, { recursive: true });
}

// ---- 3. Bản API (transport giả) ----
// Giống mục 5 của trang nộp: stub CỐ TÌNH phân rã hẹp (["solar","wind"]) để vòng find_gaps phải bù
// 4 nhánh còn thiếu, và giả lập 1 lần pause_turn của server tool web_search.
section("Bản API (transport giả)");
{
  const reqs: MessagesRequest[] = [];
  let gapRound = 0;
  let paused = false;
  const reply = (text: string, stop: MessagesResponse["stop_reason"] = "end_turn"): MessagesResponse =>
    ({ id: "m", role: "assistant", stop_reason: stop, content: [{ type: "text", text }] });
  const fake = async (req: MessagesRequest): Promise<MessagesResponse> => {
    reqs.push(structuredClone(req));
    const task = String(req.messages[0]!.content);
    if (req.system?.includes("coordinator của hệ thống")) return reply('Đây: ["solar", "wind"]');
    if (req.system?.includes("kiểm tra độ phủ"))
      return reply(gapRound++ === 0 ? '["geothermal", "tidal", "biomass", "fusion", "wind"]' : "[]");
    if (req.system?.includes("tìm kiếm")) {
      if (!paused) {
        paused = true; // lần tìm đầu: server tool chưa xong → pause_turn, phải gửi lại
        return reply("(đang tìm)", "pause_turn");
      }
      const sub = /về '(\w+)'\.\n/.exec(task)?.[1];
      // web search tách text quanh citation → nhiều block text
      return { id: "m", role: "assistant", stop_reason: "end_turn",
        content: [{ type: "text", text: `- ${sub} 2026: ` }, { type: "text", text: `https://src.example/${sub}` }] };
    }
    if (req.system?.includes("phân tích")) return reply(`Phân tích dựa trên ${/https:\S+/.exec(task)?.[0]}`);
    // người viết báo cáo: liệt kê các phần nhận được
    return reply("BÁO CÁO: " + [...task.matchAll(/^## (\w+)/gm)].map((m) => m[1]).join(", "));
  };
  const logs: string[] = [];
  const report = await hub(fake, (l) => logs.push(l)).coordinator("Renewable energy technologies");
  console.log(logs.map((l) => `      ${l}`).join("\n"));
  const searches = reqs.filter((r) => r.system?.includes("tìm kiếm"));
  const analyses = reqs.filter((r) => r.system?.includes("phân tích"));
  check("api: find_gaps bù đủ 4 nhánh, 'wind' đã có thì không làm lại → báo cáo đủ 6 loại",
    report === "BÁO CÁO: solar, wind, geothermal, tidal, biomass, fusion");
  check("api: dừng khi find_gaps trả [] (2 lần kiểm tra độ phủ)", gapRound === 2);
  check("api: spoke tìm kiếm có server tool web_search, max_uses 3",
    searches.every((r) => (r.tools as any)?.[0]?.type === "web_search_20260209" && (r.tools as any)[0].max_uses === 3));
  check("api: pause_turn → gửi lại kèm lượt assistant (cùng context)",
    searches[1]!.messages.length === 2 && searches[1]!.messages[1]!.role === "assistant");
  check("api: nối nhiều block text của web search thành một",
    String(analyses[0]!.messages[0]!.content).includes("- solar 2026: https://src.example/solar"));
  check("api: coordinator dán kết quả tìm kiếm (có URL) vào prompt spoke phân tích, 6 lần",
    analyses.length === 6 && analyses.every((r) => String(r.messages[0]!.content).includes("https://src.example/")));
  check("api: spoke phân tích không có tool, context mới (1 message)",
    analyses.every((r) => r.tools === undefined && r.messages.length === 1));
  check("api: log báo nhánh còn thiếu", logs.includes('[round 0] còn thiếu: ["geothermal","tidal","biomass","fusion"]'));
}

// ---- 4. Bản proxy (chat giả): finish_reason tool_calls → stop ----
section("Bản proxy (chat giả)");
{
  const seen: any[][] = [];
  const chat: ChatFn = async (messages, tools) => {
    seen.push(structuredClone(messages));
    const sys = String(messages[0]!.content);
    const msg = (content: string) => ({ finish_reason: "stop", message: { role: "assistant" as const, content } });
    if (sys.includes("coordinator của hệ thống")) return msg('["A","B","C","D","E"]');
    if (sys.includes("kiểm tra độ phủ")) return msg("[]");
    if (tools && messages.length === 2)
      return { finish_reason: "tool_calls", message: { role: "assistant", content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "search", arguments: '{"query":"A"}' } }] } };
    return msg(sys.includes("người viết") ? "BÁO CÁO PROXY" : "ok");
  };
  const report = await proxyHub(chat, quiet).coordinator("Năng lượng");
  const afterTool = seen.find((m) => m.at(-1)?.role === "tool");
  check("proxy: trả báo cáo", report === "BÁO CÁO PROXY");
  check("proxy: tool_calls → nối message tool có tool_call_id + kết quả giả lập",
    afterTool?.at(-1).tool_call_id === "c1" && afterTool.at(-1).content.includes("[MOCK]"));
}

// ---- 5. Đầu-cuối: run_cli.sh + claude giả + parse_hub.ts ----
section("Bản CLI (claude giả)");
function runCli(extraEnv: Record<string, string> = {}) {
  const r = spawnSync(join(ROOT, "run_cli.sh"), [], {
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, ...extraEnv },
    encoding: "utf8",
  });
  const out = r.stdout + r.stderr;
  return { out, ok: r.status === 0, runDir: /Lưu tại: (\S+)/.exec(out)?.[1] ?? "" };
}
{
  const d = mkdtempSync(join(tmpdir(), "t12e-"));
  const argvLog = join(d, "argv.log");
  let { out, ok, runDir } = runCli({ FAKE_ARGV_LOG: argvLog });
  const argv: string[] = JSON.parse(readFileSync(argvLog, "utf8").trim().split("\n").at(-1)!);
  const at = (f: string, k = 1) => argv[argv.indexOf(f) + k];
  check("e2e: --agents trỏ tới agents.json", String(at("--agents")).endsWith("agents.json"));
  check("e2e: --tools Agent (chỉ giữ Agent trong bộ built-in)", at("--tools") === "Agent");
  check("e2e: --allowedTools Agent + search", at("--allowedTools") === "Agent" && at("--allowedTools", 2) === "mcp__research__search");
  check("e2e: --system-prompt là coordinator prompt", String(at("--system-prompt")).includes("coordinator (hub)"));
  check("e2e: model haiku, stream-json, budget, strict-mcp",
    at("--model") === "haiku" && argv.includes("stream-json") && argv.includes("--max-budget-usd") && argv.includes("--strict-mcp-config"));
  check("e2e: kịch bản đúng → 8/8 PASS, exit 0", ok && (out.match(/^PASS/gm) ?? []).length === 8, out);
  check("e2e: liệt kê 11 lần spawn trong 3 lượt", out.includes("11 lần spawn, 3 lượt"));
  check("e2e: lượt 1 là 5 subagent SONG SONG", out.includes("· 5 subagent SONG SONG"));
  check("e2e: server ghi 5 search, khớp stream", out.includes("ghi nhận 5 lần search · stream-json có 5 tool_use search"));
  rmSync(runDir, { recursive: true, force: true });

  ({ out, ok, runDir } = runCli({ FAKE_MISUSE: "nested" }));
  check("misuse nested: báo FAIL 'Subagent không spawn…' + chỉ ra analysis-agent",
    !ok && out.includes("FAIL  Subagent không spawn") && out.includes("vi phạm: analysis-agent gọi search-agent"));
  rmSync(runDir, { recursive: true, force: true });

  ({ out, ok, runDir } = runCli({ FAKE_MISUSE: "search" }));
  check("misuse search: báo FAIL 'search chỉ chạy trong search-agent'",
    !ok && out.includes("FAIL  search chỉ chạy trong search-agent") && out.includes("vi phạm: analysis-agent tự gọi search"));
  rmSync(runDir, { recursive: true, force: true });
  rmSync(d, { recursive: true });
}
const runs = join(ROOT, "cli_runs");
if (existsSync(runs) && readdirSync(runs).length === 0) rmdirSync(runs);

summary();
