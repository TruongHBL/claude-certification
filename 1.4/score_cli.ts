// Bài 1.4 – chấm kết quả bản CLI. Đọc results_cli/<kịch bản>/{tools.log, state.json, stream.jsonl}.
//
// Kiểm tra bắt buộc ở MỌI kịch bản (bất biến của cổng chặn):
//   mọi refund ĐÃ thực thi đều có get_customer verified=true của đúng khách đó xảy ra TRƯỚC trong log.
// Kiểm tra riêng từng kịch bản lấy từ scenarios.json (expect).
//
// Dùng: node --experimental-strip-types score_cli.ts <results_dir> <scenarios.json> [id]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readStream, resultEvent, toolUses } from "../lib/cli_stream.ts";

interface Expect {
  ledger_orders?: string[];
  ledger_empty?: boolean;
  handoff?: boolean;
  handoff_concern_types?: string[];
}
interface Scenario { id: string; text: string; expect?: Expect }
interface LogEntry { tool: string; arguments: Record<string, any>; isError: boolean; blocked: boolean; result: any }

const [resultsDir, scenariosFile, only] = process.argv.slice(2);
let scenarios = (JSON.parse(readFileSync(scenariosFile, "utf8")) as { scenarios: Scenario[] }).scenarios;
if (only) scenarios = scenarios.filter((s) => s.id === only);

let totalFail = 0;
for (const sc of scenarios) {
  const dir = join(resultsDir, sc.id);
  const log = readStream(join(dir, "tools.log")) as unknown as LogEntry[];
  const stream = readStream(join(dir, "stream.jsonl"));
  const statePath = join(dir, "state.json");
  const state = existsSync(statePath)
    ? (JSON.parse(readFileSync(statePath, "utf8")) as { ledger: { order_id: string }[]; handoffs: any[] })
    : { ledger: [], handoffs: [] };
  const result: Record<string, any> = resultEvent(stream) ?? {};
  const checks: [string, boolean][] = [];

  // Bất biến: refund thành công chỉ sau get_customer verified của đúng khách.
  let verified: string | undefined;
  let gateOk = true;
  for (const e of log) {
    if (e.tool === "get_customer" && !e.isError && e.result?.verified === true) verified = e.result.customer_id;
    if (e.tool === "process_refund" && !e.isError && e.arguments?.customer_id !== verified) gateOk = false;
  }
  checks.push(["Cổng chặn giữ: mọi refund đã thực thi đều sau xác minh đúng khách", gateOk]);
  const ledgerFromLog = log.filter((e) => e.tool === "process_refund" && !e.isError).length;
  checks.push([`Ledger khớp log server (${state.ledger.length} refund)`, ledgerFromLog === state.ledger.length]);

  const ex = sc.expect ?? {};
  if (ex.ledger_orders) {
    const got = state.ledger.map((l) => l.order_id);
    checks.push([
      `Refund đúng đơn ${JSON.stringify(ex.ledger_orders)} (thực tế ${JSON.stringify(got)})`,
      JSON.stringify([...got].sort()) === JSON.stringify([...ex.ledger_orders].sort()),
    ]);
  }
  if (ex.ledger_empty) checks.push(["Không có refund nào (xác minh thất bại)", state.ledger.length === 0]);
  if (ex.handoff) {
    const h = state.handoffs.at(-1);
    checks.push(["Có handoff được chấp nhận (đủ 5 trường)", h !== undefined]);
    if (h && ex.handoff_concern_types) {
      const types = (h.concerns ?? []).filter((c: any) => c.status === "needs_human").map((c: any) => c.type);
      checks.push([
        `Handoff có concern cần người: ${JSON.stringify(ex.handoff_concern_types)} (thực tế ${JSON.stringify(types)})`,
        ex.handoff_concern_types.every((t) => types.includes(t)),
      ]);
    }
  }

  const blocked = log.filter((e) => e.blocked).length;
  const rejectedHandoffs = log.filter((e) => e.tool === "escalate_to_human" && e.isError).length;
  // Tool do model gọi, theo thứ tự, lấy từ stream-json (đối chiếu với log server).
  const calls = toolUses(stream).map((t) => String(t.name).replace(/^mcp__support__/, ""));
  console.log(`== ${sc.id}`);
  console.log(`   tool model gọi (stream-json): ${calls.join(" → ")}`);
  console.log(`   tool server nhận (log):       ${log.map((e) => e.tool + (e.isError ? "✗" : "")).join(" → ")}`);
  console.log(
    `   lần bị cổng chặn: ${blocked} · handoff bị từ chối: ${rejectedHandoffs} · ` +
      `chi phí: ${result.total_cost_usd ?? "?"} USD · kết thúc: ${result.subtype ?? "không có result"}`,
  );
  for (const [name, ok] of checks) {
    if (!ok) totalFail++;
    console.log(`   ${ok ? "PASS" : "FAIL"}  ${name}`);
  }
}
console.log(totalFail === 0 ? "\nTất cả kiểm tra đạt." : `\n${totalFail} kiểm tra KHÔNG đạt.`);
process.exitCode = totalFail === 0 ? 0 : 1;
