// CLAUDE GIẢ nói giao thức stream-json của Agent SDK (để test run_cli.sh / bai_1_5_sdk_hooks.ts --run).
// KHÔNG gọi model. "Model" ở đây là kịch bản cố định theo từ khoá trong prompt (GIẢ ĐỊNH).
// Cái được kiểm tra THẬT: SDK spawn đúng binary trỏ bởi CLAUDE_BIN, env không có ANTHROPIC_API_KEY,
// hook callback và SDK MCP server trong tiến trình Node được gọi đúng thứ tự Pre → tool → Post.
// Gọi qua wrapper bash `claude-sdk-fake` (Node chỉ strip type cho file đuôi .ts).
import { appendFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
if (argv[0] === "auth" && argv[1] === "status") { // run_cli.sh kiểm tra đăng nhập
  console.log(JSON.stringify({ loggedIn: true, authMethod: "fake" }));
  process.exit(0);
}
const LOG = process.env.FAKE_SDK_LOG;
const log = (h: unknown) => LOG && appendFileSync(LOG, JSON.stringify(h) + "\n");
const out = (h: unknown) => process.stdout.write(JSON.stringify(h) + "\n");
log({ argv, has_api_key: "ANTHROPIC_API_KEY" in process.env, self: process.env.FAKE_SELF ?? process.argv[1] });

const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const pending: any[] = []; // message không phải control_response đọc được trong lúc chờ
async function readMsg(): Promise<any | null> {
  if (pending.length) return pending.shift();
  for (;;) {
    const r = await lines.next();
    if (r.done) return null;
    if (r.value.trim()) return JSON.parse(r.value);
  }
}

// Gửi control_request cho SDK rồi chờ đúng control_response
async function ctl(request: Record<string, unknown>): Promise<any> {
  const id = randomBytes(6).toString("hex");
  out({ type: "control_request", request_id: id, request });
  for (;;) {
    const r = await lines.next();
    if (r.done) {
      console.error(`stdin đóng khi chờ ${request.subtype}`);
      process.exit(1);
    }
    if (!r.value.trim()) continue;
    const m = JSON.parse(r.value);
    if (m.type === "control_response" && m.response?.request_id === id) {
      if (m.response.subtype === "error") {
        console.error(`SDK trả lỗi: ${m.response.error}`);
        process.exit(1);
      }
      return m.response.response;
    }
    pending.push(m);
  }
}

let hooks: Record<string, { matcher?: string; hookCallbackIds: string[] }[]> = {};
let mcpId = 0;
const SESSION = randomUUID();

async function mcp(server: string, method: string, params?: Record<string, unknown>): Promise<any> {
  const msg: Record<string, unknown> = { jsonrpc: "2.0", id: ++mcpId, method };
  if (params) msg.params = params;
  return (await ctl({ subtype: "mcp_message", server_name: server, message: msg })).mcp_response;
}

function matches(matcher: string | undefined, name: string): boolean {
  if (!matcher || matcher === "*") return true;
  return /^[\w|]+$/.test(matcher) ? matcher.split("|").includes(name) : new RegExp(matcher).test(name);
}

async function runHooks(event: string, base: Record<string, unknown>): Promise<any[]> {
  const res: any[] = [];
  for (const m of (hooks[event] ?? []).filter((m) => matches(m.matcher, String(base.tool_name)))) {
    for (const cb of m.hookCallbackIds) {
      res.push(await ctl({ subtype: "hook_callback", callback_id: cb, tool_use_id: base.tool_use_id, input: { ...base, hook_event_name: event } }));
    }
  }
  return res;
}

let seq = 0;
async function callTool(server: string, short: string, args: Record<string, unknown>): Promise<any> {
  const name = `mcp__${server}__${short}`;
  const id = `toolu_fake_${++seq}`;
  const base = { session_id: SESSION, transcript_path: "/dev/null", cwd: process.cwd(), tool_name: name, tool_input: args, tool_use_id: id };
  out({ type: "assistant", session_id: SESSION, parent_tool_use_id: null,
    message: { id: `msg_${id}`, role: "assistant", content: [{ type: "tool_use", id, name, input: args }] } });
  const deny = (await runHooks("PreToolUse", base)).map((r) => r?.hookSpecificOutput).filter(Boolean).find((h) => h.permissionDecision === "deny");
  if (deny) {
    log({ tool: short, args, executed: false, reason: deny.permissionDecisionReason });
    out({ type: "user", session_id: SESSION, parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: deny.permissionDecisionReason }] } });
    return null;
  }
  const res = (await mcp(server, "tools/call", { name: short, arguments: args })).result;
  const upd = (await runHooks("PostToolUse", { ...base, tool_response: res }))
    .map((r) => r?.hookSpecificOutput?.updatedToolOutput).find((x) => x != null);
  const shown = upd ?? res;
  log({ tool: short, args, executed: true, raw: res?.content?.[0]?.text, to_model: shown?.content?.[0]?.text });
  out({ type: "user", session_id: SESSION, parent_tool_use_id: null,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: shown.content }] } });
  return shown;
}

// Kịch bản GIẢ cho 3 prompt của bài 1.5
async function scenario(prompt: string, servers: string[]): Promise<string> {
  const s = servers[0]!;
  let m: RegExpMatchArray | null;
  if (/ORD-1001: cho tôi biết/.test(prompt)) {
    for (const t of ["get_order", "get_shipment", "get_payment"]) await callTool(s, t, { order_id: "ORD-1001" });
    return "(GIẢ) đã đọc 3 nguồn";
  }
  if ((m = prompt.match(/Hoàn tiền \$(\d+)/))) {
    return (await callTool(s, "process_refund", { order_id: "ORD-1001", amount_usd: Number(m[1]) })) ? "(GIẢ) đã hoàn" : "(GIẢ) yêu cầu chờ duyệt";
  }
  if ((m = prompt.match(/Chuyển \$(\d+) cho khách (\S+?)\./))) {
    const amt = Number(m[1]);
    const cus = m[2];
    await callTool(s, "transfer_funds", { customer_id: cus, amount_usd: amt }); // thử trước khi AML → phải bị chặn
    await callTool(s, "aml_check", { customer_id: cus });
    return (await callTool(s, "transfer_funds", { customer_id: cus, amount_usd: amt })) ? "(GIẢ) đã chuyển" : "(GIẢ) bị chặn";
  }
  return "(GIẢ) không có kịch bản";
}

let servers: string[] = [];
for (let m = await readMsg(); m; m = await readMsg()) {
  if (m.type === "control_request") {
    const req = m.request ?? {};
    if (req.subtype === "initialize") {
      hooks = req.hooks ?? {};
      servers = req.sdkMcpServers ?? [];
      log({ initialize: { hooks: Object.fromEntries(Object.entries(hooks).map(([k, v]) => [k, v.map((x) => x.matcher)])), sdkMcpServers: servers } });
    }
    out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
  } else if (m.type === "user") {
    out({ type: "system", subtype: "init", session_id: SESSION, model: "fake", tools: [], mcp_servers: servers.map((name) => ({ name, status: "connected" })) });
    for (const sv of servers) {
      await mcp(sv, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "0" } });
    }
    const content = m.message?.content;
    const prompt = (Array.isArray(content) ? content : [content]).map((c: any) => (c && typeof c === "object" ? c.text : c)).join("");
    const text = await scenario(prompt, servers);
    out({ type: "result", subtype: "success", is_error: false, result: text, session_id: SESSION, num_turns: 1,
      duration_ms: 1, duration_api_ms: 0, total_cost_usd: 0, usage: {}, uuid: randomUUID() });
    break;
  }
}
process.exit(0);
