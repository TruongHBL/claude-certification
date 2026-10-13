// CLAUDE GIẢ cho test run_cli_hooks.sh (bài 1.5 bản thuần CLI). KHÔNG gọi model.
// "Model" = kịch bản cố định theo prompt (GIẢ ĐỊNH). Phần THẬT: đọc --settings/--mcp-config như CLI,
// spawn MCP server thật, chạy ĐÚNG lệnh hook trong settings (stdin JSON, exit code, JSON output),
// và chỉ gọi tool khi PreToolUse không chặn. Giả định thêm: tool_response của MCP tool là mảng content block.
// Gọi qua wrapper bash `claude` (Node chỉ strip type cho file đuôi .ts).
import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { McpClient } from "../../../lib/mcp_client.ts";

const args = process.argv.slice(2);
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "fake" }));
  process.exit(0);
}
if (process.env.FAKE_ARGV_LOG) appendFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify(args) + "\n");
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const prompt = opt("-p") ?? "";
const settings = JSON.parse(readFileSync(opt("--settings")!, "utf8"));
const srv = JSON.parse(readFileSync(opt("--mcp-config")!, "utf8")).mcpServers.ops;
const allowed = (opt("--allowedTools") ?? "").split(",");
const SESSION = randomUUID();
const out = (h: unknown) => process.stdout.write(JSON.stringify(h) + "\n");

function matches(m: string | undefined, name: string): boolean {
  if (!m || m === "*") return true;
  return /^[\w|]+$/.test(m) ? m.split("|").includes(name) : new RegExp(m).test(name);
}

interface HookRun { exit: number | null; stdout: string; stderr: string; json: any }
// Chạy các hook của event như Claude Code: mỗi command là 1 tiến trình, stdin = JSON
function runHooks(event: string, input: Record<string, unknown>): HookRun[] {
  const matchers: any[] = settings.hooks?.[event] ?? [];
  return matchers
    .filter((m) => matches(m.matcher, String(input.tool_name)))
    .flatMap((m) =>
      (m.hooks as { command: string }[]).map((h) => {
        const r = spawnSync("sh", ["-c", h.command], {
          input: JSON.stringify({ ...input, hook_event_name: event }),
          env: { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() },
          encoding: "utf8",
        });
        let json: any = null;
        try {
          json = JSON.parse(r.stdout);
        } catch {
          json = null;
        }
        return { exit: r.status, stdout: r.stdout, stderr: r.stderr, json };
      }),
    );
}

const mcp = new McpClient(srv.command, srv.args ?? [], srv.env ?? {});
await mcp.initialize();
const tools = ((await mcp.request("tools/list")).result.tools as { name: string }[]).map((t) => `mcp__ops__${t.name}`);
out({ type: "system", subtype: "init", session_id: SESSION, tools });

let seq = 0;
async function call(short: string, a: Record<string, unknown>): Promise<unknown> {
  const name = `mcp__ops__${short}`;
  const id = `toolu_fake_${++seq}`;
  if (!allowed.includes(name)) {
    console.error(`tool ${name} không nằm trong --allowedTools`);
    process.exit(1);
  }
  const base = { session_id: SESSION, transcript_path: "/dev/null", cwd: process.cwd(), permission_mode: "dontAsk",
    tool_name: name, tool_input: a, tool_use_id: id };
  out({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input: a }] } });
  const pre = runHooks("PreToolUse", base);
  const blocked = pre.find((h) => h.exit === 2);
  const deny = pre.map((h) => h.json?.hookSpecificOutput).filter(Boolean).find((h) => h.permissionDecision === "deny");
  if (blocked || deny) {
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: true,
      content: deny ? deny.permissionDecisionReason : blocked!.stderr }] } });
    return null;
  }
  const content = (await mcp.callTool(short, a)).result.content;
  const post = runHooks("PostToolUse", { ...base, tool_response: content });
  const upd = post.map((h) => h.json?.hookSpecificOutput).filter(Boolean)
    .map((h) => h.updatedToolOutput ?? h.updatedMCPToolOutput).find((x) => x != null);
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: upd ?? content }] } });
  return upd ?? content;
}

let result: string;
let m: RegExpMatchArray | null;
if (/ORD-1001: cho tôi biết/.test(prompt)) {
  for (const t of ["get_order", "get_shipment", "get_payment"]) await call(t, { order_id: "ORD-1001" });
  result = "(GIẢ) đã đọc 3 nguồn";
} else if ((m = prompt.match(/Hoàn tiền \$(\d+)/))) {
  result = (await call("process_refund", { order_id: "ORD-1001", amount_usd: Number(m[1]) })) ? "(GIẢ) đã hoàn" : "(GIẢ) chờ duyệt";
} else if ((m = prompt.match(/Chuyển \$(\d+) cho khách (\S+?)\./))) {
  const amt = Number(m[1]);
  const cus = m[2];
  await call("transfer_funds", { customer_id: cus, amount_usd: amt });
  await call("aml_check", { customer_id: cus });
  result = (await call("transfer_funds", { customer_id: cus, amount_usd: amt })) ? "(GIẢ) đã chuyển" : "(GIẢ) bị chặn";
} else {
  result = "(GIẢ) không có kịch bản";
}
out({ type: "result", subtype: "success", result, session_id: SESSION, total_cost_usd: 0 });
mcp.close();
