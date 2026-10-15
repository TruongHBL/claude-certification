// Bài 3.3 – so CANARY mà Claude in ra (stream-json của run_cli.sh) với mô hình match_rules.ts,
// và so input token thật giữa hai biến thể (rules theo path vs gom vào root CLAUDE.md).
// Dùng: node --experimental-strip-types report_cli.ts <results_cli> <.tmp>
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readStream, resultEvent, toolUses } from "../lib/cli_stream.ts";
import { CANARY_RE, canariesFor, SAMPLE_FILES } from "./match_rules.ts";

export const CASES = [{ kind: "none", file: "" }, ...SAMPLE_FILES];

export interface Row {
  variant: string;
  kind: string;
  file: string;
  expected: string[];
  seen: string[];
  missing: string[];
  extra: string[];
  reads: string[];
  inputTokens?: number;
  costUsd?: number;
  ok: boolean;
}

/** Tổng token đầu vào của lệnh (kể cả phần ghi/đọc cache), lấy từ result.usage nếu có. */
function inputTokensOf(usage: any): number | undefined {
  if (!usage) return undefined;
  return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

export function compare(resultsDir: string, tmpDir: string): Row[] {
  const rows: Row[] = [];
  for (const variant of ["rules", "root"]) {
    for (const c of CASES) {
      const path = join(resultsDir, variant, `${c.kind}.jsonl`);
      if (!existsSync(path)) continue;
      const events = readStream(path);
      const expected = canariesFor(join(tmpDir, variant), c.file ? [c.file] : []);
      const res = resultEvent(events);
      const text =
        (res?.result as string | undefined) ??
        events
          .filter((e) => e.type === "assistant" && Array.isArray(e.message?.content))
          .flatMap((e) => e.message!.content.filter((b: any) => b.type === "text").map((b: any) => b.text))
          .join("\n");
      const seen = [...new Set(text.match(CANARY_RE) ?? [])].sort();
      const reads = toolUses(events)
        .filter((t) => t.name === "Read")
        .map((t) => String(t.input?.file_path ?? "").replace(/^.*?\/(?=src\/|terraform\/|routes\/|infrastructure\/)/, ""));
      const missing = expected.filter((x) => !seen.includes(x));
      const extra = seen.filter((x) => !expected.includes(x));
      rows.push({
        variant,
        kind: c.kind,
        file: c.file,
        expected,
        seen,
        missing,
        extra,
        reads,
        inputTokens: inputTokensOf(res?.usage),
        costUsd: res?.total_cost_usd,
        ok: !missing.length && !extra.length,
      });
    }
  }
  return rows;
}

export function render(rows: Row[]): string {
  const out: string[] = [];
  out.push(`${"biến thể".padEnd(8)} ${"ca".padEnd(10)} ${"đã Read".padEnd(24)} ${"input tok".padStart(9)}  kết quả`);
  for (const r of rows) {
    const verdict = r.ok ? "OK" : `KHÁC  thiếu=[${r.missing.join(" ")}] dư=[${r.extra.join(" ")}]`;
    out.push(
      `${r.variant.padEnd(8)} ${r.kind.padEnd(10)} ${(r.reads.join(",") || "—").padEnd(24)} ${String(r.inputTokens ?? "?").padStart(9)}  ${verdict}`,
    );
    out.push(`${"".padEnd(20)}thấy: ${r.seen.join(" ") || "NONE"}`);
  }
  const by = (v: string, k: string) => rows.find((r) => r.variant === v && r.kind === k)?.inputTokens;
  out.push("\nChênh input token (root − rules) cùng một ca — phần quy ước KHÔNG liên quan bị nạp thừa ở biến thể root:");
  for (const k of CASES.map((c) => c.kind)) {
    const a = by("rules", k);
    const b = by("root", k);
    if (a !== undefined && b !== undefined) out.push(`  ${k.padEnd(10)} rules=${a}  root=${b}  chênh=${b - a}`);
  }
  const cost = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  out.push(`\n${rows.filter((r) => r.ok).length}/${rows.length} ca khớp mô hình · tổng chi phí ${cost.toFixed(4)} USD`);
  return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [resultsDir, tmpDir] = process.argv.slice(2);
  if (!resultsDir || !tmpDir) {
    console.error("Dùng: report_cli.ts <results_cli> <.tmp>");
    process.exit(2);
  }
  console.log(render(compare(resultsDir, tmpDir)));
}
