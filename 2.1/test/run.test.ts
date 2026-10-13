// Bài 2.1 – kiểm thử server MCP (JSON-RPC thật qua stdio) và pipeline run.sh + score.ts với claude GIẢ.
// Không gọi model. Pipeline chạy trong thư mục tạm (RESULTS_DIR) nên không đụng results/ (kết quả chạy thật).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpClient } from "../../lib/mcp_client.ts";
import { check, section, summary } from "../../lib/check.ts";

const ROOT = join(import.meta.dirname, "..");
const SERVER = join(ROOT, "shop_mcp_server.ts");
const TS = ["--experimental-strip-types", "--no-warnings"];

section("Server: TOOLSET=vague");
{
  const c = McpClient.forTsServer(SERVER, { TOOLSET: "vague" });
  const init = await c.initialize();
  check("initialize trả serverInfo shop", init.result?.serverInfo?.name === "shop");
  const tools = (await c.request("tools/list")).result.tools;
  check("2 tool get_customer, lookup_order", tools.map((t: any) => t.name).join() === "get_customer,lookup_order");
  check("mô tả vague 1 câu (< 60 ký tự)", tools.every((t: any) => t.description.length < 60));
  check("cả hai chỉ nhận chung field query", tools.every((t: any) => Object.keys(t.inputSchema.properties).join() === "query"));
  const r = await c.callTool("lookup_order", { query: "đơn #12345 tới đâu" });
  check("vague: dò được mã đơn trong chuỗi query", JSON.parse(r.result.content[0].text).order_number === "#12345");
  c.close();
}

section("Server: TOOLSET=clear");
{
  const log = join(mkdtempSync(join(tmpdir(), "shop21-")), "calls.log");
  const c = McpClient.forTsServer(SERVER, { TOOLSET: "clear", SHOP_LOG: log });
  await c.initialize();
  const tools = (await c.request("tools/list")).result.tools;
  const [cust, order] = tools;
  check("mô tả clear dài 5 dòng mỗi tool", tools.every((t: any) => t.description.split("\n").length === 5));
  check("get_customer có ranh giới 'KHÔNG dùng khi … mã đơn'", /KHÔNG dùng khi câu hỏi có mã đơn/.test(cust.description));
  check("lookup_order có ranh giới 'KHÔNG dùng để tra hồ sơ'", /KHÔNG dùng để tra hồ sơ/.test(order.description));
  check("schema tách field customer_id/email/phone", Object.keys(cust.inputSchema.properties).join() === "customer_id,email,phone");
  check("pattern mã đơn ^#\\d{5}$", order.inputSchema.properties.order_number.pattern === "^#\\d{5}$");
  const ok = await c.callTool("lookup_order", { order_number: "#12345" });
  check("lookup_order #12345 trả đơn đang giao", JSON.parse(ok.result.content[0].text).status === "Đang giao" && !ok.result.isError);
  const byPhone = await c.callTool("get_customer", { phone: "0987654321" });
  check("get_customer theo SĐT trả CUS-0117", JSON.parse(byPhone.result.content[0].text).customer_id === "CUS-0117");
  const miss = await c.callTool("lookup_order", { order_number: "#99999" });
  check("không có đơn → isError + not_found", miss.result.isError === true && JSON.parse(miss.result.content[0].text).error === "not_found");
  const unknown = await c.callTool("delete_order", {});
  check("tool không tồn tại → lỗi giao thức JSON-RPC -32602", unknown.error?.code === -32602);
  const foo = await c.request("foo");
  check("method lạ → -32601", foo.error?.code === -32601);
  c.close();
  const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  check("SHOP_LOG ghi mỗi tools/call 1 dòng (4 dòng)", lines.length === 4 && lines[0].tool === "lookup_order" && lines[0].toolset === "clear");
}

section("Pipeline run.sh all với claude GIẢ (heuristic viết tay, không phải Claude)");
{
  const dir = mkdtempSync(join(tmpdir(), "results21-"));
  const argvLog = join(dir, "argv.log");
  const r = spawnSync("bash", [join(ROOT, "run.sh"), "all"], {
    cwd: ROOT, encoding: "utf8",
    env: { ...process.env, PATH: `${join(ROOT, "test/bin")}:${process.env.PATH}`, RESULTS_DIR: dir, FAKE_ARGV_LOG: argvLog },
  });
  check("run.sh all thoát 0", r.status === 0, r.stderr.slice(0, 300));
  const score = JSON.parse(readFileSync(join(dir, "score.json"), "utf8")) as { config: string; correct: number }[];
  const byCfg = Object.fromEntries(score.map((s) => [s.config, s.correct]));
  check("điểm GIẢ A 5, B 9, C 10", byCfg.A === 5 && byCfg.B === 9 && byCfg.C === 10, JSON.stringify(byCfg));
  const argv = readFileSync(argvLog, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
  check("30 lệnh claude (10 query × 3 cấu hình)", argv.length === 30);
  const a0 = argv[0];
  const has = (f: string, v?: string) => { const i = a0.indexOf(f); return i >= 0 && (v === undefined || a0[i + 1] === v); };
  check("cờ: --tools \"\" --strict-mcp-config --model haiku --output-format stream-json",
    has("--tools", "") && has("--strict-mcp-config") && has("--model", "haiku") && has("--output-format", "stream-json"));
  check("cờ: --allowedTools đúng 2 tool MCP", has("--allowedTools", "mcp__shop__get_customer") && a0.includes("mcp__shop__lookup_order"));
  check("không dùng --safe-mode / --bare", !a0.includes("--safe-mode") && !a0.includes("--bare"));
  check("results/ thật không bị ghi đè (vẫn còn A/q1.jsonl)", existsSync(join(ROOT, "results/A/q1.jsonl")));

  // Dự phòng: xoá stream-json, chấm chỉ bằng log server
  for (const cfg of ["A", "B", "C"]) for (let i = 1; i <= 10; i++) writeFileSync(join(dir, cfg, `q${i}.jsonl`), "");
  const s2 = spawnSync(process.execPath, [...TS, join(ROOT, "score.ts"), dir, join(ROOT, "queries.json")], { encoding: "utf8" });
  check("chấm bằng log server khi không có stream-json: vẫn 5/9/10", /A\s+vague \+ conflict\s+5\/10[\s\S]*B\s+clear \+ conflict\s+9\/10[\s\S]*C\s+clear \+ fixed\s+10\/10/.test(s2.stdout));
  rmSync(dir, { recursive: true, force: true });
}

section("score.ts trên kết quả chạy THẬT (results/, 13/10/2026)");
if (existsSync(join(ROOT, "results/A"))) {
  const tmp = mkdtempSync(join(tmpdir(), "score21-"));
  // Chấm trên bản sao để không ghi đè results/score.json
  spawnSync("cp", ["-r", join(ROOT, "results/A"), join(ROOT, "results/B"), join(ROOT, "results/C"), tmp]);
  const s = spawnSync(process.execPath, [...TS, join(ROOT, "score.ts"), tmp, join(ROOT, "queries.json")], { encoding: "utf8" });
  check("kết quả thật: A 8/10, B 8/10, C 10/10", /A\s+vague \+ conflict\s+8\/10[\s\S]*B\s+clear \+ conflict\s+8\/10[\s\S]*C\s+clear \+ fixed\s+10\/10/.test(s.stdout), s.stdout.slice(-200));
  rmSync(tmp, { recursive: true, force: true });
} else {
  console.log("(bỏ qua: không có results/ — thư mục này không đưa lên git)");
}

summary();
