// Bài 2.3 – bản CLI: chấm một lần chạy `claude -p` từ 3 log trong thư mục:
//   hook.jsonl   – cli/guard_hook.ts: mọi lệnh gọi tool, agent nào gọi, pass/deny + luật
//   server.jsonl – cli/research_mcp_server.ts: lệnh gọi THỰC SỰ được thực thi
//   stream.jsonl – stream-json của claude: kết quả cuối, chi phí, số lượt
//
//   node --experimental-strip-types audit_cli.ts logs/cli/run
//   node --experimental-strip-types audit_cli.ts logs/cli/misuse --misuse   # mong đợi: có vi phạm VÀ bị chặn
// Thoát 0 nếu mọi kiểm tra của chế độ đó đạt.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { allowedNames } from "./tool_config.ts";

type Row = Record<string, any>;

export function readJsonl(path: string): Row[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").flatMap((l) => {
    if (!l.trim()) return [];
    try {
      return [JSON.parse(l) as Row];
    } catch {
      return [];
    }
  });
}

export interface AuditCheck { name: string; ok: boolean; detail: string }
export interface AuditResult {
  checks: AuditCheck[];
  table: Record<string, Record<string, number>>;
  violations: Row[];
  gateDenials: Row[];
  result?: Row;
  fake: boolean;
}

const tally = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const fmtTally = (t: Record<string, number>) => Object.entries(t).map(([k, v]) => `${k}×${v}`).join(", ");
const isAllowed = (role: unknown, tool: unknown) => {
  try {
    return typeof role === "string" && allowedNames(role).includes(String(tool));
  } catch {
    return false;
  }
};

export function audit(dir: string, { misuse = false } = {}): AuditResult {
  const hook = readJsonl(join(dir, "hook.jsonl"));
  const server = readJsonl(join(dir, "server.jsonl"));
  const stream = readJsonl(join(dir, "stream.jsonl"));
  const checks: AuditCheck[] = [];
  const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

  const passed = hook.filter((e) => e.decision === "pass");
  const denied = hook.filter((e) => e.decision === "deny");
  const violations = denied.filter((e) => ["outside_allowlist", "unknown_agent"].includes(e.rule));
  const gateDenials = denied.filter((e) => e.rule === "metadata_gate");

  // Bảng tool theo agent (chỉ lệnh được cho qua)
  const table: Record<string, Record<string, number>> = {};
  for (const e of passed) {
    const t = (table[e.agent] ??= {});
    t[e.tool] = (t[e.tool] ?? 0) + 1;
  }

  add("có log hook (hook PreToolUse thực sự chạy)", hook.length > 0, `${hook.length} lệnh gọi tool`);

  const outside = passed.filter((e) => !(e.role && isAllowed(e.role, e.tool)));
  add("mọi lệnh được cho qua đều nằm trong bộ tool của agent gọi", outside.length === 0,
    [...new Set(outside.map((e) => `${e.agent}→${e.tool}`))].join(", "));

  // Mọi lệnh server thực thi phải từng được hook cho qua (không có đường vòng qua hook).
  const mcpPassed = tally(passed.filter((e) => e.tool !== "Agent").map((e) => e.tool));
  const exec = tally(server.map((e) => e.tool));
  const bypass = Object.entries(exec).filter(([t, n]) => n > (mcpPassed[t] ?? 0));
  add("server chỉ thực thi lệnh đã qua hook", bypass.length === 0, bypass.map(([t, n]) => `${t}×${n}`).join(", "));
  const notPassedExec = Object.keys(exec).filter((t) => !(t in mcpPassed));
  const leaked = violations.map((e) => String(e.tool)).filter((t) => notPassedExec.includes(t));
  add("lệnh vi phạm không được thực thi", leaked.length === 0, leaked.join(", "));

  const doc = new Map<string, Row[]>();
  for (const e of passed.filter((e) => e.role === "doc_analysis")) {
    const k = e.agent_id ?? `${e.session_id}-${e.agent_type}`;
    doc.set(k, [...(doc.get(k) ?? []), e]);
  }
  const firsts = [...doc.values()].map((es) => String(es[0].tool));
  add(`doc-analysis: lệnh đầu tiên được thực thi trong mỗi phiên là extract_metadata (${doc.size} phiên)`,
    doc.size > 0 && firsts.every((t) => t === "extract_metadata"),
    `${fmtTally(tally(firsts))}; cổng hook chặn ${gateDenials.length} lệnh sai thứ tự`);

  const syn = table.synthesis ?? {};
  add("synthesis dùng compile_report + verify_fact", (syn.compile_report ?? 0) > 0 && (syn.verify_fact ?? 0) > 0, fmtTally(syn));

  const report = [...server].reverse().find((e) => e.tool === "compile_report" && !e.isError);
  const pending: unknown[] = report ? [report.args?.needs_coordinator_verification ?? []].flat() : [];
  const verifiedLater = passed.some((e) => e.role === "doc_analysis" && e.tool === "verify_claim");
  add("nhận định phức tạp được chuyển coordinator → doc-analysis verify_claim",
    pending.length === 0 || verifiedLater,
    pending.length === 0 ? "báo cáo không có nhận định chờ kiểm chứng" : `${pending.length} nhận định chờ, verify_claim: ${verifiedLater}`);

  const coordDomain = passed.filter((e) => e.role === "coordinator" && !["Agent", "review_output", "request_revision"].includes(e.tool));
  add("coordinator không tự dùng tool nghiệp vụ", coordDomain.length === 0, [...new Set(coordDomain.map((e) => e.tool))].join(", "));

  if (misuse) {
    add("DEMO cấu hình sai: hook bắt được ≥ 1 vi phạm", violations.length > 0,
      violations.map((e) => `${e.agent}→${e.tool}`).join(", "));
  } else {
    add("không có vi phạm", violations.length === 0, `${violations.length} vi phạm`);
  }

  const result = [...stream].reverse().find((e) => e.type === "result");
  add("claude kết thúc không lỗi", !!result && result.is_error === false,
    result ? `subtype=${result.subtype}` : "không có sự kiện result trong stream.jsonl");

  return { checks, table, violations, gateDenials, result, fake: stream.some((e) => e.type === "system" && e.fake) };
}

export function printReport(r: AuditResult): void {
  console.log(r.fake ? "(log từ `claude` GIẢ – kịch bản cố định, không phải Claude)" : "(log từ claude thật)");
  console.log("\nTool theo agent (lệnh được cho qua):");
  for (const [agent, tools] of Object.entries(r.table)) console.log(`  ${agent.padEnd(13)} ${fmtTally(tools)}`);
  if (r.gateDenials.length) {
    console.log("\nCổng extract_metadata đã chặn:");
    for (const e of r.gateDenials) console.log(`  ${e.agent} (${e.agent_id}) → ${e.tool}`);
  }
  if (r.violations.length) {
    console.log("\nVi phạm bị hook chặn:");
    for (const e of r.violations) console.log(`  ${e.agent} → ${e.tool} [${e.rule}]`);
  }
  if (r.result) console.log(`\nChi phí: ${JSON.stringify(r.result.total_cost_usd ?? null)} USD · số lượt: ${JSON.stringify(r.result.num_turns ?? null)}`);
  console.log("\nKiểm tra:");
  for (const c of r.checks) console.log(`  ${c.ok ? "ĐẠT " : "TRƯỢT"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  console.log(`\n${r.checks.filter((c) => c.ok).length}/${r.checks.length} đạt`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const dir = argv.find((a) => !a.startsWith("--"));
  if (!dir) {
    console.error("Dùng: node --experimental-strip-types audit_cli.ts <thư_mục_log> [--misuse]");
    process.exit(1);
  }
  const r = audit(dir, { misuse: argv.includes("--misuse") });
  printReport(r);
  process.exitCode = r.checks.every((c) => c.ok) ? 0 : 1;
}
