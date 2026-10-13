// Test bài 1.1 (bản API với transport GIẢ + bản CLI với `claude` GIẢ trong test/bin/). Không gọi model.
//   node --experimental-strip-types test/run_tests.test.ts

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, section, summary } from "../../lib/check.ts";
import { McpClient } from "../../lib/mcp_client.ts";
import type { MessagesRequest, MessagesResponse, Transport } from "../../lib/anthropic.ts";
import { agent, MAX_ITERATIONS } from "../bai_1_1_agentic_loop.ts";
import { evaluate, formatNumber } from "../tools.ts";

const ROOT = join(import.meta.dirname, "..");
const BIN = join(import.meta.dirname, "bin");

// ---- 1. MCP server qua stdio ----
section("MCP server");
{
  const d = mkdtempSync(join(tmpdir(), "t11-"));
  const log = join(d, "t.log");
  const c = McpClient.forTsServer(join(ROOT, "loop_mcp_server.ts"), { LOOP_LOG: log });
  const init = await c.initialize();
  const list = await c.request("tools/list");
  const r3 = await c.callTool("web_search", { query: "dân số Hà Nội" });
  const r4 = await c.callTool("calculator", { expression: "(9.5 - 8.7) / 8.7 * 100" });
  const r5 = await c.callTool("calculator", { expression: "1/0" });
  const r6 = await c.callTool("calculator", { expression: "2 ^ 3" });
  const r7 = await c.request("foo/bar");
  c.close();
  check("server: initialize trả serverInfo loop", init.result?.serverInfo?.name === "loop");
  check("server: tools/list có web_search + calculator",
    JSON.stringify(list.result.tools.map((t: any) => t.name)) === '["web_search","calculator"]');
  check("server: web_search trả số liệu giả lập", r3.result.content[0].text.includes("8,7 triệu"));
  check("server: calculator tính đúng 9.1954", r4.result.content[0].text === "9.1954");
  check("server: chia 0 → isError", r5.result.isError === true);
  check("server: ký tự lạ → isError", r6.result.isError === true);
  check("server: method lạ → -32601", r7.error?.code === -32601);
  check("server: ghi log 4 lần tools/call", readFileSync(log, "utf8").trim().split("\n").length === 4);
  rmSync(d, { recursive: true });
}

// ---- 2. Bản API: vòng lặp với transport GIẢ ----
section("Bản API (transport giả)");
{
  check("calc: ưu tiên toán tử + ngoặc + dấu phẩy thập phân", evaluate("2 + 3 * (4 - 1) / 1,5") === 8);
  check("calc: số nguyên in kiểu '18.0'", formatNumber(evaluate("8.5 + 9.5")) === "18.0");

  // Kịch bản (giống mục 5 của trang nộp):
  //   lượt 0: text + 2 web_search song song (check theo content[0].type == "text" sẽ dừng sai ở đây)
  //   lượt 1: calculator với input sai → tool trả is_error
  //   lượt 2: Claude sửa input, gọi 2 phép tính; lượt 3: end_turn
  const script: MessagesResponse[] = [
    { id: "m0", role: "assistant", stop_reason: "tool_use", content: [
      { type: "text", text: "Để tôi tra số liệu." },
      { type: "tool_use", id: "t1", name: "web_search", input: { query: "dân số Hà Nội 2024" } },
      { type: "tool_use", id: "t2", name: "web_search", input: { query: "dân số TP. Hồ Chí Minh 2024" } }] },
    { id: "m1", role: "assistant", stop_reason: "tool_use", content: [
      { type: "tool_use", id: "t3", name: "calculator", input: { expression: "8,7 triệu + 9,5 triệu" } }] },
    { id: "m2", role: "assistant", stop_reason: "tool_use", content: [
      { type: "tool_use", id: "t4", name: "calculator", input: { expression: "8,7 + 9,5" } },
      { type: "tool_use", id: "t5", name: "calculator", input: { expression: "(9.5 - 8.7) / 8.7 * 100" } }] },
    { id: "m3", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Tổng ~18,2 triệu; TP.HCM đông hơn ~9,2%." }] },
  ];
  const reqs: MessagesRequest[] = [];
  let pairedOk = true; // mỗi lượt sau lượt 0: message cuối phải là tool_result khớp tool_use_id của lượt trước
  const fake: Transport = async (req) => {
    reqs.push(structuredClone(req));
    const i = reqs.length - 1;
    if (i > 0) {
      const want = script[i - 1]!.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : []));
      const last = req.messages.at(-1)!;
      const got = Array.isArray(last.content) ? last.content.map((b: any) => b.tool_use_id) : [];
      if (last.role !== "user" || JSON.stringify(got) !== JSON.stringify(want)) pairedOk = false;
    }
    return script[i]!;
  };
  const logs: string[] = [];
  const answer = await agent("q", fake, (l) => logs.push(l));
  check("api: trả text của lượt end_turn", answer === "Tổng ~18,2 triệu; TP.HCM đông hơn ~9,2%.");
  check("api: đúng 4 lần gọi API, không dừng ở lượt 0 dù có text", reqs.length === 4);
  check("api: mỗi lượt gửi tool_result khớp tool_use_id của lượt trước, gộp trong MỘT message user", pairedOk);
  const errResult = (reqs[2]!.messages.at(-1)!.content as any[])[0];
  check("api: input sai → tool_result is_error kèm thông báo để Claude tự sửa",
    errResult.is_error === true && errResult.content === "Lỗi: ký tự không hợp lệ: triệutriệu");
  check("api: kết quả calculator thật (18.2 và 9.1954) nối vào lượt 3",
    JSON.stringify((reqs[3]!.messages.at(-1)!.content as any[]).map((b) => b.content)) === '["18.2","9.1954"]');
  console.log(logs.map((l) => `      ${l}`).join("\n"));

  // stop_reason lạ → báo lỗi, không coi là xong
  let threw = false;
  try {
    await agent("q", async () => ({ id: "x", role: "assistant", stop_reason: "max_tokens", content: [] }), () => {});
  } catch (e) {
    threw = /max_tokens/.test((e as Error).message);
  }
  check("api: stop_reason=max_tokens → ném lỗi", threw);

  // tool_use mãi → dừng ở lưới an toàn
  let n = 0;
  const origWarn = console.warn;
  console.warn = () => {};
  const loop = await agent("q", async () => {
    n++;
    return { id: "y", role: "assistant", stop_reason: "tool_use",
      content: [{ type: "tool_use", id: `l${n}`, name: "calculator", input: { expression: "1+1" } }] };
  }, () => {});
  console.warn = origWarn;
  check(`api: kẹt tool_use → dừng ở MAX_ITERATIONS=${MAX_ITERATIONS}, trả null`, loop === null && n === MAX_ITERATIONS);
}

// ---- 3. Đầu-cuối: run_cli.sh + claude giả + parse_loop.ts ----
section("Bản CLI (claude giả)");
function runCli(extraEnv: Record<string, string> = {}) {
  const r = spawnSync(join(ROOT, "run_cli.sh"), [], {
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, ...extraEnv },
    encoding: "utf8",
  });
  const out = r.stdout + r.stderr;
  const runDir = /Lưu tại: (\S+)/.exec(out)?.[1] ?? "";
  return { out, ok: r.status === 0, runDir };
}
{
  const d = mkdtempSync(join(tmpdir(), "t11e-"));
  const argvLog = join(d, "argv.log");
  let { out, ok, runDir } = runCli({ FAKE_ARGV_LOG: argvLog });
  const argv: string[] = JSON.parse(readFileSync(argvLog, "utf8").trim().split("\n").at(-1)!);
  const at = (f: string) => argv[argv.indexOf(f) + 1];
  check('e2e: lệnh claude có -p, stream-json, --verbose', argv.includes("-p") && argv.includes("stream-json") && argv.includes("--verbose"));
  check('e2e: --tools "" (tắt tool built-in)', at("--tools") === "");
  check("e2e: --allowedTools đúng 2 tool MCP",
    at("--allowedTools") === "mcp__loop__web_search" && argv[argv.indexOf("--allowedTools") + 2] === "mcp__loop__calculator");
  check("e2e: --strict-mcp-config + --max-budget-usd + --model haiku",
    argv.includes("--strict-mcp-config") && argv.includes("--max-budget-usd") && at("--model") === "haiku");
  check("e2e: không dùng --bare / --safe-mode", !argv.includes("--bare") && !argv.includes("--safe-mode"));
  check("e2e: exit 0, 4 PASS của parser", ok && (out.match(/^PASS/gm) ?? []).length === 4, out);
  check("e2e: gom 2 dòng cùng message.id thành 1 lượt → 3 lượt", out.includes("Số lượt API (gom theo message.id): 3"));
  check("e2e: 4 tool_use, ghép đủ 4/4 tool_result", out.includes("tool_result ghép được: 4/4"));
  check("e2e: server ghi 4 lần, khớp số tool_use", out.includes("4 lần tools/call (khớp số tool_use)"));
  check("e2e: kết quả calculator thật từ server (9.1954)", out.includes("9.1954"));
  check("e2e: lưu report.txt", existsSync(join(runDir, "report.txt")));
  rmSync(runDir, { recursive: true, force: true });

  ({ out, runDir } = runCli({ FAKE_NO_STOP_REASON: "1" }));
  check("thiếu stop_reason → suy ra và đánh dấu (suy ra)", out.includes("stop_reason=tool_use (suy ra)") && out.includes("end_turn (suy ra)"));
  rmSync(runDir, { recursive: true, force: true });

  ({ out, ok, runDir } = runCli({ FAKE_DROP_RESULT: "1" }));
  check("thiếu tool_result → parser báo FAIL, exit≠0", out.includes("FAIL  Mọi tool_use đều có tool_result") && !ok);
  rmSync(runDir, { recursive: true, force: true });
  rmSync(d, { recursive: true });
}
const runs = join(ROOT, "cli_runs");
if (existsSync(runs) && readdirSync(runs).length === 0) rmdirSync(runs);

summary();
