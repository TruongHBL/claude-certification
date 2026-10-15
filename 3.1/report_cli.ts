// Bài 3.1 – so CANARY mà Claude in ra (stream-json của run_cli.sh) với mô hình expected_loading.ts.
// Dùng: node --experimental-strip-types report_cli.ts <results_cli> <.tmp> [user CLAUDE.md]
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readStream, resultEvent, toolUses } from "../lib/cli_stream.ts";
import { CANARY_RE, expectedLoading, USER_CANARY } from "./expected_loading.ts";

export interface Row {
  who: string;
  name: string;
  cwd: string;
  expected: string[];
  seen: string[];
  missing: string[]; // mong đợi mà không thấy
  extra: string[]; // thấy mà không mong đợi
  reads: string[];
  ok: boolean;
  costUsd?: number;
}

const CASES = [
  { who: "me", name: "root", cwd: ".", reads: [] as string[] },
  { who: "me", name: "api", cwd: "packages/api", reads: [] },
  { who: "me", name: "web", cwd: "packages/web", reads: [] },
  { who: "newcomer", name: "root", cwd: ".", reads: [] },
  { who: "newcomer", name: "api", cwd: "packages/api", reads: [] },
  { who: "newcomer", name: "web", cwd: "packages/web", reads: [] },
  { who: "newcomer", name: "root-ondemand", cwd: ".", reads: ["packages/api/src/routes.ts"] },
];

export function compare(resultsDir: string, tmpDir: string, userClaudeMd = join(homedir(), ".claude", "CLAUDE.md")): Row[] {
  // Khối demo có trong user-level thật không (chỉ đọc, không sửa).
  const userHasCanary = existsSync(userClaudeMd) && readFileSync(userClaudeMd, "utf8").includes(USER_CANARY);
  const rows: Row[] = [];
  for (const c of CASES) {
    const file = join(resultsDir, c.who, `${c.name}.jsonl`);
    if (!existsSync(file)) continue;
    const repo = join(tmpDir, c.who);
    const expected = expectedLoading({
      repoRoot: repo,
      cwd: join(repo, c.cwd),
      userLevel: c.who === "me",
      userClaudeMd,
      readFiles: c.reads.map((r) => join(repo, r)),
    })
      .map((l) => l.canary)
      .filter((x): x is string => !!x && (x !== USER_CANARY || userHasCanary));
    const events = readStream(file);
    const text =
      (resultEvent(events)?.result as string | undefined) ??
      events
        .filter((e) => e.type === "assistant" && Array.isArray(e.message?.content))
        .flatMap((e) => e.message!.content.filter((b: any) => b.type === "text").map((b: any) => b.text))
        .join("\n");
    const seen = [...new Set(text.match(CANARY_RE) ?? [])].sort();
    const missing = expected.filter((x) => !seen.includes(x));
    const extra = seen.filter((x) => !expected.includes(x));
    const reads = toolUses(events)
      .filter((t) => t.name === "Read")
      .map((t) => String(t.input?.file_path ?? ""));
    rows.push({ ...c, expected, seen, missing, extra, reads, ok: !missing.length && !extra.length, costUsd: resultEvent(events)?.total_cost_usd });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [resultsDir, tmpDir, user] = process.argv.slice(2);
  const rows = compare(resultsDir, tmpDir, user || undefined);
  if (!rows.length) {
    console.log(`Không có kết quả trong ${resultsDir}: chạy ./run_cli.sh run trước`);
    process.exit(1);
  }
  let cost = 0;
  for (const r of rows) {
    cost += r.costUsd ?? 0;
    console.log(`\n${r.ok ? "OK  " : "KHÁC"} ${r.who.padEnd(8)} cwd=${r.cwd}${r.reads.length ? `  (đã Read: ${r.reads.map((p) => p.split("/").slice(-3).join("/")).join(", ")})` : ""}`);
    console.log(`     mong đợi: ${r.expected.join(", ") || "(không)"}`);
    console.log(`     thấy    : ${r.seen.join(", ") || "(không)"}`);
    if (r.missing.length) console.log(`     THIẾU   : ${r.missing.join(", ")}`);
    if (r.extra.length) console.log(`     DƯ      : ${r.extra.join(", ")}`);
  }
  const ok = rows.filter((r) => r.ok).length;
  console.log(`\n${ok}/${rows.length} khớp mô hình · tổng chi phí ${cost.toFixed(4)} USD`);
}
