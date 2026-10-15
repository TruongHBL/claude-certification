// Bài 3.2 – đọc stream-json của run_cli.sh, in bảng kết quả. Không gọi model.
// Dùng: node --experimental-strip-types report_cli.ts <results_cli>
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readStream, resultEvent, type StreamEvent } from "../lib/cli_stream.ts";

export const DEMO_NAMES = ["review", "analyse-feature", "lint", "brainstorm"];

const text = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => (typeof b === "string" ? b : (b?.text ?? JSON.stringify(b)))).join("") : JSON.stringify(c ?? "");

/** Tên lệnh/skill thấy trong system:init (bỏ tiền tố plugin như "superpowers:"; chỉ giữ 4 tên của bài). */
export function listedNames(events: StreamEvent[]): { skills: string[]; slash: string[] } {
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const pick = (arr: unknown) =>
    (Array.isArray(arr) ? arr : []).map((x) => String(typeof x === "string" ? x : ((x as any)?.name ?? ""))).filter((n) => DEMO_NAMES.includes(n));
  return { skills: pick(init?.skills), slash: pick(init?.slash_commands) };
}

export interface Isolation {
  mainToolCalls: number; // tool_use do hội thoại chính gọi (parent_tool_use_id = null)
  mainToolChars: number; // ký tự tool_use + tool_result nằm trong hội thoại chính
  forkToolCalls: number; // tool_use trong subagent / forked skill
  forkToolChars: number;
  forkedCommand: boolean; // có message mang parent "forked-command-…"
  skillToolCalled: boolean; // Claude gọi tool Skill (tự chọn skill nhờ description)
  resultChars: number; // độ dài câu trả lời cuối
  costUsd?: number;
}

export function isolation(events: StreamEvent[]): Isolation {
  const r: Isolation = { mainToolCalls: 0, mainToolChars: 0, forkToolCalls: 0, forkToolChars: 0, forkedCommand: false, skillToolCalled: false, resultChars: 0 };
  for (const e of events) {
    if (e.type !== "assistant" && e.type !== "user") continue;
    const parent = e.parent_tool_use_id ?? null;
    if (typeof parent === "string" && parent.startsWith("forked-command-")) r.forkedCommand = true;
    const blocks = Array.isArray(e.message?.content) ? e.message!.content : [];
    for (const b of blocks) {
      let chars = 0;
      if (b.type === "tool_use") {
        chars = JSON.stringify(b.input ?? {}).length;
        if (parent === null && b.name === "Skill") r.skillToolCalled = true;
        if (parent === null) r.mainToolCalls++;
        else r.forkToolCalls++;
      } else if (b.type === "tool_result") {
        chars = text(b.content).length;
      } else continue;
      if (parent === null) r.mainToolChars += chars;
      else r.forkToolChars += chars;
    }
  }
  const res = resultEvent(events);
  r.resultChars = String(res?.result ?? "").length;
  r.costUsd = typeof res?.total_cost_usd === "number" ? res.total_cost_usd : undefined;
  return r;
}

export function report(dir: string): string[] {
  const out: string[] = [];
  const load = (n: string) => readStream(join(dir, `${n}.jsonl`));
  const status = existsSync(join(dir, "personal_status.txt")) ? readFileSync(join(dir, "personal_status.txt"), "utf8").trim() : "(không rõ)";
  const personal = status.startsWith("ĐÃ CÀI");

  const list = load("list");
  if (list.length) {
    const { skills, slash } = listedNames(list);
    const seen = new Set([...skills, ...slash]);
    out.push("== Bước 1, 5: lệnh thấy được trong system:init (clone)");
    out.push(`Skill cá nhân /brainstorm: ${status}`);
    const want: Record<string, boolean> = { review: true, "analyse-feature": true, lint: false, brainstorm: personal };
    for (const n of DEMO_NAMES) {
      const ok = seen.has(n) === want[n];
      out.push(`  ${ok ? "OK  " : "LỆCH"} /${n.padEnd(16)} thấy=${seen.has(n) ? "có" : "không"}  mong đợi=${want[n] ? "có" : "không"}`);
    }
  }

  const rows = ["fork", "nofork", "auto"].map((n) => [n, load(n)] as const).filter(([, ev]) => ev.length);
  if (rows.length) {
    out.push("", "== Bước 6: output của skill có đổ vào hội thoại chính không");
    out.push("phiên    tool chính  ký tự chính  tool fork  ký tự fork  forked-command  gọi Skill  câu trả lời  USD");
    for (const [n, ev] of rows) {
      const i = isolation(ev);
      out.push(
        `${n.padEnd(8)} ${String(i.mainToolCalls).padStart(10)}  ${String(i.mainToolChars).padStart(11)}  ${String(i.forkToolCalls).padStart(9)}  ${String(i.forkToolChars).padStart(10)}  ${(i.forkedCommand ? "có" : "không").padStart(14)}  ${(i.skillToolCalled ? "có" : "không").padStart(9)}  ${String(i.resultChars).padStart(11)}  ${i.costUsd?.toFixed(4) ?? "?"}`,
      );
    }
    const f = rows.find(([n]) => n === "fork");
    const nf = rows.find(([n]) => n === "nofork");
    if (f && nf) {
      const a = isolation(f[1]);
      const b = isolation(nf[1]);
      out.push("", `Kết luận: nội dung tool trong hội thoại chính: fork ${a.mainToolChars} ký tự, nofork ${b.mainToolChars} ký tự.`);
      out.push(a.mainToolChars < b.mainToolChars ? "→ context: fork giữ output khám phá ngoài hội thoại chính." : "→ KHÔNG thấy khác biệt như mong đợi: đọc lại stream-json.");
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Dùng: report_cli.ts <results_cli>");
    process.exit(2);
  }
  console.log(report(dir).join("\n"));
}
