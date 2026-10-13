#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Bài 2.1 – chấm tool được gọi ĐẦU TIÊN cho từng query, từng cấu hình.
// Nguồn chính: block tool_use đầu tiên trong stream-json (qN.jsonl).
// Dự phòng: dòng đầu của log server (qN.log), nếu stream-json không đọc được.
// Dùng: node --experimental-strip-types score.ts results queries.json
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readStream, toolUses } from "../lib/cli_stream.ts";

interface Query { id: number; text: string; expected: string }

const [resultsDir, queriesFile] = process.argv.slice(2);
if (!resultsDir || !queriesFile) {
  console.error("Dùng: score.ts <results_dir> <queries.json>");
  process.exit(2);
}
const queries = (JSON.parse(readFileSync(queriesFile, "utf8")) as { queries: Query[] }).queries;
const CONFIGS: Record<string, string> = { A: "vague + conflict", B: "clear + conflict", C: "clear + fixed" };

function firstToolFromStream(path: string): string | undefined {
  return toolUses(readStream(path))[0]?.name.replace(/^mcp__shop__/, "");
}

function firstToolFromLog(path: string): string | undefined {
  if (!existsSync(path) || statSync(path).size === 0) return undefined;
  const first = readFileSync(path, "utf8").split("\n")[0];
  return (JSON.parse(first) as { tool: string }).tool;
}

const summary: { config: string; label: string; correct: number; total: number }[] = [];
for (const [cfg, label] of Object.entries(CONFIGS)) {
  const dir = join(resultsDir, cfg);
  if (!existsSync(dir)) continue;

  const rows = queries.map((q) => {
    const got = firstToolFromStream(join(dir, `q${q.id}.jsonl`)) ??
      firstToolFromLog(join(dir, `q${q.id}.log`)) ?? "(không gọi tool)";
    return { ...q, got, ok: got === q.expected };
  });
  const correct = rows.filter((r) => r.ok).length;
  summary.push({ config: cfg, label, correct, total: rows.length });
  console.log(`\n== ${cfg} (${label}): ${correct}/${rows.length}`);
  for (const r of rows.filter((r) => !r.ok)) {
    console.log(`   ✗ q${r.id}: cần ${r.expected}, gọi ${r.got}  | ${r.text}`);
  }
}

if (summary.length === 0) {
  console.log(`Chưa có kết quả trong ${resultsDir}. Chạy ./run.sh all trước.`);
  process.exit(1);
}
console.log("\nCấu hình             Đúng");
for (const s of summary) {
  console.log(`${s.config.padEnd(2)} ${s.label.padEnd(17)} ${String(s.correct).padStart(2)}/${s.total}`);
}
writeFileSync(join(resultsDir, "score.json"), JSON.stringify(summary, null, 2) + "\n");
