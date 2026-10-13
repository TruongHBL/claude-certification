// Bài 2.2 – kiểm thử server (bơm JSON-RPC qua stdin) và vòng hồi phục. Không gọi model.
// Chạy: node --experimental-strip-types test/run.test.ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, section, summary } from "../../lib/check.ts";

process.env.BACKOFF_SCALE = "0.01";
const { SERVER, SCENARIOS, runScenario, runBatch, fixCustomerId } = await import("../recovery_agent.ts");
const ROOT = join(import.meta.dirname, "..");
const TS = ["--experimental-strip-types", "--no-warnings"];

function rpcSession(lines: object[], env: Record<string, string> = {}): any[] {
  const input = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  const r = spawnSync(process.execPath, [...TS, SERVER], { input, encoding: "utf8", env: { ...process.env, ...env } });
  return r.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const call = (id: number, name: string, args: object) =>
  ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

section("Server");
const init = { jsonrpc: "2.0", id: 0, method: "initialize", params: {} };
let r = rpcSession([init, { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 1, method: "tools/list" },
  call(2, "get_customer", { customer_id: "CUS-0012", simulate: "timeout" }),
  call(3, "get_customer", { customer_id: "cus-12" }),
  call(4, "process_refund", { customer_id: "CUS-0012", amount: 750 }),
  call(5, "get_customer", { customer_id: "CUS-0777" }),
  call(6, "get_customer", { customer_id: "CUS-9999" }),
  call(7, "get_custmer", {}),
  call(8, "process_refund", { customer_id: "CUS-0012" }),
  { jsonrpc: "2.0", id: 9, method: "foo/bar" }]);
const byId = Object.fromEntries(r.map((m) => [m.id, m]));
check("notification không được trả lời (11 message, 10 có id → 10 response)", r.length === 10);
check("tools/list có 2 tool", byId[1].result.tools.map((t: any) => t.name).join() === "get_customer,process_refund");
check("customer_id không khai báo pattern trong schema",
  byId[1].result.tools[0].inputSchema.properties.customer_id.pattern === undefined);
for (const [id, cat, retry] of [[2, "transient", true], [3, "validation", false], [4, "business", false], [5, "permission", false]] as const) {
  const sc = byId[id].result.structuredContent;
  check(`${cat}: isError=true, đúng 3 field, isRetryable=${retry}`,
    byId[id].result.isError === true && Object.keys(sc).sort().join() === "description,errorCategory,isRetryable" &&
    sc.errorCategory === cat && sc.isRetryable === retry && sc.description.length > 40);
}
const empty = byId[6].result;
check("rỗng hợp lệ: isError=false, resultCount=0, không có errorCategory",
  empty.isError === false && empty.structuredContent.resultCount === 0 && !("errorCategory" in empty.structuredContent));
const accessKeys = Object.keys(byId[2].result.structuredContent);
check("rỗng hợp lệ ≠ access failure (khác isError và khác key)",
  empty.isError !== byId[2].result.isError && Object.keys(empty.structuredContent).every((k) => !accessKeys.includes(k)));
check("tool không tồn tại → JSON-RPC error -32602, không có result", byId[7].error?.code === -32602 && !("result" in byId[7]));
check("thiếu tham số bắt buộc → JSON-RPC error", String(byId[8].error?.message).includes("missing amount"));
check("method lạ → -32601", byId[9].error?.code === -32601);

r = rpcSession([init, ...[1, 2, 3].map((i) => call(i, "get_customer", { customer_id: "CUS-0042", simulate: "flaky:2" }))]);
check("flaky:2: lần 1,2 transient, lần 3 thành công", r[1].result.isError && r[2].result.isError && r[3].result.isError === false);

const bad = rpcSession([init, call(1, "get_customer", { customer_id: "CUS-9999" }),
  call(2, "process_refund", { customer_id: "CUS-0012", amount: 750 })], { ERROR_STYLE: "bad" });
check("ERROR_STYLE=bad: rỗng và business đều chỉ là \"Error\", không metadata",
  bad.slice(1).every((m) => m.result.isError && m.result.content[0].text === "Error" && !("structuredContent" in m.result)));

section("Agent structured");
const res = new Map<number, Awaited<ReturnType<typeof runScenario>>>();
for (const s of SCENARIOS) res.set(s.id, await runScenario("structured", s));
for (const s of SCENARIOS) {
  const x = res.get(s.id)!;
  check(`structured #${s.id} ${s.name}: ${s.expect} sau ${s.expectCalls} lần gọi`, x.outcome === s.expect && x.calls === s.expectCalls,
    `${x.outcome} sau ${x.calls}`);
}
check("business / permission / rỗng: gọi đúng 1 lần, không retry",
  [2, 7, 8].every((i) => res.get(i)!.calls === 1 && res.get(i)!.delays.length === 0));
check("timeout: dừng sau 3 retry (1 + 3 = 4 lần gọi)", res.get(4)!.calls === 4 && res.get(4)!.delays.length === 3);
const d = res.get(4)!.delays;
check("backoff tăng dần ×2 (0.2 → 0.4 → 0.8, đã scale)", d.slice(1).every((b, i) => Math.abs(b / d[i] - 2) < 1e-9));
check("flaky:2 thành công ở lần gọi thứ 3 với 2 delay", res.get(3)!.calls === 3 && res.get(3)!.delays.length === 2);
check("validation sửa được: lần 2 dùng CUS-0012", res.get(5)!.log.some((l) => l.includes("'cus 12' → 'CUS-0012'")));
const h = res.get(7)!.handoff!;
check("handoff business có mã khách, số tiền, lý do", h.customer_id === "CUS-0012" && h.amount_usd === 750 && h.reason.includes("500"));
check("fixCustomerId", fixCustomerId("cus-0012") === "CUS-0012" && fixCustomerId("CUS12") === "CUS-0012" && fixCustomerId("order-abc") === null);

const batch = (await runBatch("structured")).report;
check("lan truyền: báo cáo có kết quả 1 phần + khách lỗi + khách rỗng tách riêng",
  batch.found.join() === "CUS-0012" && batch.not_found.join() === "CUS-9999" && batch.failed.map((f) => f.customer_id).join() === "CUS-0042");

section("Agent với lỗi kiểu cũ (ERROR_STYLE=bad)");
const badres = new Map<number, Awaited<ReturnType<typeof runScenario>>>();
for (const s of SCENARIOS) badres.set(s.id, await runScenario("bad", s));
check("bad: rỗng hợp lệ bị retry vô ích rồi escalate (4 lần)", badres.get(2)!.outcome === "escalated" && badres.get(2)!.calls === 4);
check("bad: business bị retry (4 lần gọi hoàn tiền)", badres.get(7)!.calls === 4);
check("bad: validation sửa được nhưng không sửa (escalate)", badres.get(5)!.outcome === "escalated");
const sum = (m: typeof res) => [...m.values()].reduce((n, x) => n + x.calls, 0);
check("bad: tổng số lần gọi nhiều hơn structured (30 > 16)", sum(badres) === 30 && sum(res) === 16, `${sum(badres)} vs ${sum(res)}`);
const bb = (await runBatch("bad")).report;
check("bad: lan truyền lẫn khách không tồn tại vào nhóm lỗi", bb.not_found.length === 0 && bb.failed.length === 2);

section("run_llm.sh với claude GIẢ (không gọi model, chỉ kiểm đường ống)");
{
  const dir = mkdtempSync(join(tmpdir(), "llm22-"));
  const p = spawnSync("bash", [join(ROOT, "run_llm.sh"), "all"], {
    cwd: ROOT, encoding: "utf8",
    env: { ...process.env, PATH: `${join(ROOT, "test/bin")}:${process.env.PATH}`, RESULTS_DIR: dir },
  });
  check("run_llm.sh all thoát 0", p.status === 0, p.stderr.slice(0, 300));
  const cfg = JSON.parse(readFileSync(join(dir, "structured/p0.mcp.json"), "utf8")).mcpServers.support;
  check("mcp-config trỏ tới server TS chạy bằng node", cfg.args.includes(SERVER) && cfg.args.includes("--experimental-strip-types"));
  check("report: p0 structured gọi get_customer 1 lần, kết quả rỗng hợp lệ",
    /structured[\s\S]*p0:[^\n]*\n\s+1 lần gọi: get_customer\(\{"customer_id":"CUS-9999"\}\)[^\n]*\n\s+trả lời: \(GIẢ\) \{"results":\[\],"resultCount":0/.test(p.stdout));
  check("report: p1 bad hoàn tiền chỉ thấy \"Error\"", /== bad[\s\S]*p1:[^\n]*\n[^\n]*process_refund[^\n]*\n\s+trả lời: \(GIẢ\) Error/.test(p.stdout));
  rmSync(dir, { recursive: true, force: true });
}

summary();
