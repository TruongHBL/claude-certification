// Test bản CLI bài 1.4.
//  Phần 1 (THẬT, không cần model): gửi JSON-RPC vào support_mcp_server.ts, kiểm cổng chặn + handoff validator.
//  Phần 2 (GIẢ): run_cli.sh all với `claude` giả (test/bin/claude) → kiểm đường chạy end-to-end + bộ chấm.
// Chạy: node --experimental-strip-types test/cli.test.ts
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { McpClient } from "../../lib/mcp_client.ts";
import { check, section, summary } from "../../lib/check.ts";

const ROOT = join(import.meta.dirname, "..");
const TS = [process.execPath, "--experimental-strip-types", "--no-warnings"];

type Call = (name: string, args: Record<string, unknown>) => Promise<any>;
type Rpc = (method: string, params?: Record<string, unknown>) => Promise<any>;

// Mỗi phiên = 1 server process + 1 file state.
async function session(dir: string, body: (rpc: Rpc, call: Call) => Promise<void>) {
  const c = McpClient.forTsServer(join(ROOT, "support_mcp_server.ts"), {
    STATE_FILE: join(dir, "state.json"),
    SUPPORT_LOG: join(dir, "tools.log"),
  });
  await body(
    (m, p = {}) => c.request(m, p),
    async (n, a) => (await c.callTool(n, a)).result,
  );
  c.close();
  return JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
}

const REFUND = { customer_id: "C-001", order_id: "ORD-1001", amount: 120, reason: "hỏng" };
const GOOD = { email: "an@example.com", phone_last4: "6789" };
const text = (r: any) => r.content[0].text as string;

section("Phần 1: server thật qua JSON-RPC");
{
  const d = mkdtempSync(join(tmpdir(), "t14-"));
  const st = await session(d, async (rpc, call) => {
    check("initialize trả serverInfo support", (await rpc("initialize")).result.serverInfo.name === "support");
    const names = (await rpc("tools/list")).result.tools.map((t: any) => t.name).sort();
    check("tools/list có đủ 4 tool", JSON.stringify(names) === JSON.stringify(["escalate_to_human", "get_customer", "lookup_order", "process_refund"]));
    let r = await call("process_refund", REFUND);
    check("refund khi chưa xác minh → isError + BLOCKED", r.isError === true && text(r).startsWith("BLOCKED"));
    r = await call("get_customer", { ...GOOD, phone_last4: "1111" });
    check("sai 4 số cuối → verified false", JSON.parse(text(r)).verified === false);
    r = await call("process_refund", REFUND);
    check("xác minh thất bại thì refund vẫn bị chặn", r.isError === true);
    await call("get_customer", GOOD);
    r = await call("process_refund", { ...REFUND, customer_id: "C-002", order_id: "ORD-2001" });
    check("refund cho khách khác khách đã xác minh → chặn", r.isError === true && text(r).includes("khác khách"));
    r = await call("process_refund", { ...REFUND, amount: 999 });
    check("số tiền vượt giá trị đơn → lỗi", r.isError === true);
    r = await call("process_refund", REFUND);
    check("sau khi xác minh đúng → refund thành công", r.isError === undefined && JSON.parse(text(r)).status === "refunded");
    r = await call("escalate_to_human", {
      customer_id: "C-001", conversation_summary: "x", root_cause_analysis: "TBD",
      refund_amount: 0, recommended_action: "N/A", concerns: [],
    });
    check(
      "handoff có placeholder/rỗng → bị từ chối, nêu đủ trường",
      r.isError === true && ["root_cause_analysis", "recommended_action", "concerns"].every((k) => text(r).includes(k)),
    );
    r = await call("escalate_to_human", {
      customer_id: "C-001", conversation_summary: "Khách hỏi trừ tiền 2 lần",
      root_cause_analysis: "Cổng thanh toán trừ trùng", refund_amount: 0,
      recommended_action: "Đối soát giao dịch",
      concerns: [{ type: "billing_dispute", detail: "trừ 2 lần", status: "needs_human" }],
    });
    check("handoff đủ 5 trường → escalated", JSON.parse(text(r)).status === "escalated");
    r = await rpc("tools/call", { name: "delete_everything", arguments: {} });
    check("tool lạ → lỗi giao thức JSON-RPC -32602, tool không chạy", r.error?.code === -32602 && r.result === undefined);
    check("method lạ → JSON-RPC -32601", (await rpc("foo/bar")).error?.code === -32601);
  });
  check("ledger chỉ có đúng 1 refund (các lệnh bị chặn không có side effect)", st.ledger.length === 1);
  const log = readFileSync(join(d, "tools.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  check("log server ghi mọi lần gọi, đánh dấu blocked", log.length === 10 && log.filter((e) => e.blocked).length === 3);
  rmSync(d, { recursive: true, force: true });
}
{
  const d = mkdtempSync(join(tmpdir(), "t14-"));
  await session(d, async (_, call) => void (await call("get_customer", GOOD)));
  const st = await session(d, async (_, call) => void (await call("process_refund", REFUND)));
  check("state theo file: xác minh ở lần chạy server trước vẫn giữ trong cùng phiên", st.ledger.length === 1);
  rmSync(d, { recursive: true, force: true });
}

section("Phần 2: end-to-end với claude GIẢ");
{
  const d = mkdtempSync(join(tmpdir(), "t14e-"));
  const results = join(ROOT, "results_cli");
  const backup = existsSync(results) ? join(d, "bak") : null;
  if (backup) renameSync(results, backup);
  const argvLog = join(d, "argv.log");
  const env = { ...process.env, CLAUDE_BIN: join(ROOT, "test/bin/claude"), FAKE_ARGV_LOG: argvLog };
  const r = spawnSync(join(ROOT, "run_cli.sh"), ["all"], { encoding: "utf8", env });
  const out = r.stdout + r.stderr;
  console.log(out.split("\n").map((l) => `   | ${l}`).join("\n"));
  check("run_cli.sh all + score_cli.ts: mọi kiểm tra đạt", r.status === 0 && out.includes("Tất cả kiểm tra đạt."));
  check("kịch bản skip: bộ chấm thấy 1 lần bị cổng chặn", out.match(/== skip\n[\s\S]*?lần bị cổng chặn: (\d+)/)?.[1] === "1");
  check("kịch bản multi: bộ chấm thấy 1 handoff bị từ chối", out.match(/== multi\n[\s\S]*?handoff bị từ chối: (\d+)/)?.[1] === "1");
  const argv = readFileSync(argvLog, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
  const first = argv[0];
  const opt = (n: string) => first[first.indexOf(n) + 1];
  check("gọi claude 4 lần (4 kịch bản)", argv.length === 4);
  check(
    'cờ CLI đúng: -p, --tools "", --strict-mcp-config, --permission-mode dontAsk, stream-json',
    first.includes("-p") && opt("--tools") === "" && first.includes("--strict-mcp-config") &&
      opt("--permission-mode") === "dontAsk" && opt("--output-format") === "stream-json",
  );
  check("allowedTools đúng 4 tool mcp__support__*", first.filter((a) => a.startsWith("mcp__support__")).length === 4);
  // Bộ chấm phải bắt được khi cổng chặn bị vượt: sửa log giả để refund thành công trước xác minh.
  const wp = join(results, "wrongphone");
  writeFileSync(join(wp, "tools.log"), JSON.stringify({ tool: "process_refund", arguments: REFUND, isError: false, blocked: false, result: {} }) + "\n");
  writeFileSync(join(wp, "state.json"), JSON.stringify({ ledger: [{ order_id: "ORD-1001" }], handoffs: [] }));
  const r2 = spawnSync(TS[0], [...TS.slice(1), join(ROOT, "score_cli.ts"), results, join(ROOT, "scenarios.json"), "wrongphone"], { encoding: "utf8" });
  check("bộ chấm báo FAIL khi refund xảy ra trước xác minh", r2.status !== 0 && r2.stdout.includes("FAIL  Cổng chặn giữ"));
  rmSync(results, { recursive: true, force: true });
  if (backup) renameSync(backup, results);
  rmSync(d, { recursive: true, force: true });
}

summary();
