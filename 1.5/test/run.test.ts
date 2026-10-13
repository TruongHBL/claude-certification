// Test bài 1.5 bản không cần API key. KHÔNG gọi model.
//   THẬT : shell hook (bơm JSON qua stdin đúng như Claude Code), MCP server (bơm JSON-RPC), script chạy.
//   GIẢ  : "model" chọn tool trong test/bin/fake_claude.ts và test/bin/claude_sdk_fake.ts là kịch bản cố định.
// Chạy: node --experimental-strip-types --no-warnings test/run.test.ts   (phần SDK cần node_modules ở gốc repo)
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, section, summary } from "../../lib/check.ts";

const ROOT = join(import.meta.dirname, "..");
const REPO = join(ROOT, "..");
const HOOKS = join(ROOT, "cli", "hooks");
const TS = ["--experimental-strip-types", "--no-warnings"];
const STATE = mkdtempSync(join(tmpdir(), "hook15-"));
const lines = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()) : []);

function hook(script: string, input: unknown): [number | null, any, string] {
  const r = spawnSync(process.execPath, [...TS, join(HOOKS, script)], {
    input: JSON.stringify(input), env: { ...process.env, HOOK_STATE_DIR: STATE }, encoding: "utf8",
  });
  let j: any = null;
  try {
    j = JSON.parse(r.stdout);
  } catch {
    j = null;
  }
  return [r.status, j, r.stderr];
}
const pre = (tool: string, args: unknown, sid = "s1") =>
  ({ session_id: sid, hook_event_name: "PreToolUse", tool_name: `mcp__ops__${tool}`, tool_input: args, tool_use_id: "t" });
const post = (tool: string, resp: unknown, sid = "s1") =>
  ({ session_id: sid, hook_event_name: "PostToolUse", tool_name: `mcp__ops__${tool}`, tool_input: {}, tool_response: resp, tool_use_id: "t" });
const decision = (j: any) => j?.hookSpecificOutput?.permissionDecision;

section("Hook (THẬT, bơm JSON stdin)");
let [st, j] = hook("pre_refund_limit.ts", pre("process_refund", { order_id: "ORD-1", amount_usd: 750 }));
check("refund 750 → deny (exit 0 + JSON)", st === 0 && decision(j) === "deny", JSON.stringify(j)?.slice(0, 90));
[st, j] = hook("pre_refund_limit.ts", pre("process_refund", { order_id: "ORD-1", amount_usd: 500 }));
check("refund 500 (đúng hạn mức) → không chặn", st === 0 && j === null);
[, j] = hook("pre_refund_limit.ts", pre("process_refund", { order_id: "ORD-1", amount_usd: "abc" }));
check("refund số tiền không hợp lệ → deny", decision(j) === "deny");
const esc = lines(join(STATE, "escalations.jsonl")).length;
check("mỗi lần deny refund ghi 1 escalation", esc === 2, `${esc} dòng`);

[, j] = hook("pre_aml_gate.ts", pre("transfer_funds", { customer_id: "CUS-42", amount_usd: 200 }));
check("transfer khi chưa AML → deny", decision(j) === "deny");
hook("post_aml_record.ts", post("aml_check", [{ type: "text", text: '{"customer_id":"CUS-42","aml":"pass"}' }]));
[, j] = hook("pre_aml_gate.ts", pre("transfer_funds", { customer_id: "CUS-42", amount_usd: 200 }));
check("AML pass rồi → transfer được", j === null);
[, j] = hook("pre_aml_gate.ts", pre("transfer_funds", { customer_id: "CUS-42", amount_usd: 200 }, "s2"));
check("AML pass ở phiên khác KHÔNG có hiệu lực (khoá theo session_id)", decision(j) === "deny");
[, j] = hook("pre_aml_gate.ts", pre("transfer_funds", { customer_id: "CUS-99", amount_usd: 1 }));
check("AML pass của khách khác KHÔNG có hiệu lực", decision(j) === "deny");
hook("post_aml_record.ts", post("aml_check", [{ type: "text", text: '{"customer_id":"BLOCKED-1","aml":"fail"}' }]));
[, j] = hook("pre_aml_gate.ts", pre("transfer_funds", { customer_id: "BLOCKED-1", amount_usd: 1 }));
check("AML fail → vẫn chặn", decision(j) === "deny");

const order = '{"order_id":"ORD-1001","created_ts":1790845200,"status_code":2}';
const want = { source: "order", id: "ORD-1001", date: "2026-10-01T09:00:00.000Z", status: "shipped" };
const shape = (x: unknown) => (typeof x === "string" ? "string" : Array.isArray(x) ? "array" : typeof x);
const cases: [string, unknown][] = [
  ["mảng content block", [{ type: "text", text: order }]],
  ["{content: [...]}", { content: [{ type: "text", text: order }] }],
  ["chuỗi", order],
];
for (const [label, resp] of cases) {
  [, j] = hook("post_normalize.ts", post("get_order", resp));
  const u = j?.hookSpecificOutput?.updatedToolOutput;
  const txt = typeof u === "string" ? u : (Array.isArray(u) ? u : u?.content)?.[0]?.text;
  let ok = false;
  try {
    ok = JSON.stringify(JSON.parse(String(txt))) === JSON.stringify(want) && shape(u) === shape(resp);
  } catch {
    ok = false;
  }
  check(`normalize get_order, tool_response dạng ${label}, giữ nguyên hình dạng`, ok);
}
[, j] = hook("post_normalize.ts", post("get_shipment", [{ type: "text", text: '{"tracking_no":"SHP-1","shipped_at":"2026-10-03T09:30:00+09:00","state":"IN_TRANSIT"}' }]));
let s = JSON.parse(j.hookSpecificOutput.updatedToolOutput[0].text);
check("normalize get_shipment: +09:00 → UTC, IN_TRANSIT → in transit", s.date === "2026-10-03T00:30:00.000Z" && s.status === "in transit");
[, j] = hook("post_normalize.ts", post("get_payment", [{ type: "text", text: '{"payment_id":"PAY-1","paid_on":"02/10/2026","st":"P"}' }]));
s = JSON.parse(j.hookSpecificOutput.updatedToolOutput[0].text);
check("normalize get_payment: DD/MM/YYYY → ISO, P → paid", s.date === "2026-10-02T00:00:00.000Z" && s.status === "paid");
[st, j] = hook("post_normalize.ts", post("aml_check", [{ type: "text", text: "{}" }]));
check("normalize bỏ qua tool không phải get_*", st === 0 && j === null);

section("MCP server (THẬT, bơm JSON-RPC)");
const ledger = join(STATE, "ledger.txt");
const reqs = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "process_refund", arguments: { order_id: "ORD-9", amount_usd: 10 } } },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } },
].map((x) => JSON.stringify(x)).join("\n") + "\n";
const srv = spawnSync(process.execPath, [...TS, join(ROOT, "cli", "ops_mcp_server.ts")], {
  input: reqs, env: { ...process.env, LEDGER_FILE: ledger }, encoding: "utf8",
});
const res = srv.stdout.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
check("server trả 4 phản hồi (notification không có phản hồi)", res.length === 4);
check("tools/list có đủ 6 tool", JSON.stringify(res[1]?.result?.tools?.map((t: any) => t.name).sort()) ===
  JSON.stringify(["aml_check", "get_order", "get_payment", "get_shipment", "process_refund", "transfer_funds"]));
check("tool tiền tệ ghi LEDGER khi thực sự chạy", existsSync(ledger) && readFileSync(ledger, "utf8").includes("refund ORD-9 $10"));
check("tool lạ → JSON-RPC error (lỗi giao thức)", res[3]?.error?.code === -32602);

section("Đầu-cuối run_cli_hooks.sh với claude GIẢ (hook + server THẬT, chọn tool GIẢ)");
let env: NodeJS.ProcessEnv = { ...process.env, PATH: `${ROOT}/test/bin:${process.env.PATH}`, ANTHROPIC_API_KEY: "sk-dummy-phai-bi-unset",
  FAKE_ARGV_LOG: join(STATE, "argv.log") };
let r = spawnSync(join(ROOT, "run_cli_hooks.sh"), { env, encoding: "utf8" });
let o = r.stdout + r.stderr;
check("run_cli_hooks.sh chạy xong", r.status === 0, r.status === 0 ? "" : o.slice(-300));
const led = existsSync(join(ROOT, "cli", "state", "ledger.txt")) ? readFileSync(join(ROOT, "cli", "state", "ledger.txt"), "utf8") : "";
check("LEDGER chỉ có 1 giao dịch hợp lệ (refund 750 không chạy)", JSON.stringify(led.split("\n").filter((l) => l.trim())) === JSON.stringify(["transfer CUS-42 $200"]), JSON.stringify(led));
check("output ra model đã chuẩn hoá (date ISO, status chữ)", o.includes('"status":"shipped"') && o.includes('"status":"paid"'));
const argvs = lines(join(STATE, "argv.log")).map((l) => JSON.parse(l) as string[]);
check("mỗi prompt một lệnh claude -p riêng", argvs.filter((a) => a.includes("-p")).length === 3);
const a = argvs.find((x) => x.includes("-p")) ?? [];
check('cờ đúng: --settings, --strict-mcp-config, --tools "", --permission-mode dontAsk',
  a.includes("--settings") && a.includes("--strict-mcp-config") && a[a.indexOf("--tools") + 1] === "" && a[a.indexOf("--permission-mode") + 1] === "dontAsk");
spawnSync(join(ROOT, "run_cli_hooks.sh"), ["clean"], { stdio: "ignore" });

section("Đầu-cuối run_cli.sh (Agent SDK THẬT → claude-sdk-fake nói giao thức stream-json)");
if (existsSync(join(REPO, "node_modules", "@anthropic-ai", "claude-agent-sdk"))) {
  const log = join(STATE, "sdk.log");
  env = { ...process.env, CLAUDE_BIN: join(ROOT, "test", "bin", "claude-sdk-fake"), FAKE_SDK_LOG: log, ANTHROPIC_API_KEY: "sk-dummy-phai-bi-unset" };
  r = spawnSync(join(ROOT, "run_cli.sh"), { env, encoding: "utf8" });
  o = r.stdout + r.stderr;
  check("run_cli.sh chạy xong qua SDK", r.status === 0, r.status === 0 ? "" : o.slice(-400));
  const rows = lines(log).map((l) => JSON.parse(l) as Record<string, any>);
  check("SDK spawn đúng binary trỏ bởi CLAUDE_BIN", rows.some((x) => String(x.self ?? "").endsWith("claude-sdk-fake")));
  check("tiến trình con KHÔNG có ANTHROPIC_API_KEY", rows.filter((x) => "has_api_key" in x).every((x) => !x.has_api_key));
  check("SDK đăng ký 4 hook callback + SDK MCP server ops",
    rows.some((x) => JSON.stringify(x.initialize?.sdkMcpServers) === '["ops"]' && x.initialize?.hooks?.PreToolUse?.length === 2));
  check("refund 750 bị hook TS chặn, không thực thi", rows.some((x) => x.tool === "process_refund" && x.executed === false));
  check("LEDGER trong tiến trình Node chỉ có transfer hợp lệ", o.includes("LEDGER: [ 'transfer CUS-42 $200' ]"),
    o.split("\n").filter((l) => l.includes("LEDGER")).join(" ").trim());
} else {
  console.log("BỎ QUA (chưa npm install ở gốc repo)");
}

summary();
