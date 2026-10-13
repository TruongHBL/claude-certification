// Test bản CLI bài 1.6 (GIẢ: `claude` giả trong test/bin, kết quả dựng từ ANSWER_KEY).
// Kiểm: cờ CLI, số lệnh, song song, integration không nhận code, parser 3 kênh, compare chạy đúng.
// Chạy: node --experimental-strip-types test/cli.test.ts
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { check, summary } from "../../lib/check.ts";
import { extractStructured } from "../review_cli.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "bai_1_6_results_cli");

const d = mkdtempSync(join(tmpdir(), "t16-"));
const backup = existsSync(OUT) ? join(d, "bak") : null;
if (backup) renameSync(OUT, backup);
const argvLog = join(d, "argv.log");
const env = { ...process.env, CLAUDE_BIN: join(ROOT, "test/bin/claude"), FAKE_ARGV_LOG: argvLog };
const r = spawnSync(join(ROOT, "run_cli.sh"), ["all"], { encoding: "utf8", env });
const out = r.stdout + r.stderr;
console.log(out.split("\n").map((l) => `   | ${l}`).join("\n"));
check("run_cli.sh all chạy xong (mã 0)", r.status === 0);

const argv = readFileSync(argvLog, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
const opt = (a: string[], n: string) => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
const schemaOf = (a: string[]) => JSON.parse(opt(a, "--json-schema")!) as { properties: Record<string, unknown>; required: string[] };
check("đúng 14 lệnh claude (1 single + 12 per-file + 1 integration)", argv.length === 14);
check(
  'mọi lệnh: -p, --json-schema, --tools "", dontAsk, stream-json, --no-session-persistence',
  argv.every((a) =>
    a.includes("-p") && !!opt(a, "--json-schema") && opt(a, "--tools") === "" &&
    opt(a, "--permission-mode") === "dontAsk" && opt(a, "--output-format") === "stream-json" &&
    a.includes("--no-session-persistence")),
);
const perFile = argv.filter((a) => "exports" in schemaOf(a).properties);
check("12 lệnh per-file, mỗi lệnh chứa ĐÚNG 1 file", perFile.length === 12 && perFile.every((a) => (opt(a, "-p")!.match(/^=== /gm) ?? []).length === 1));
check(
  "schema per-file = FILE_REVIEW_TOOL.input_schema của bản API",
  JSON.stringify(schemaOf(perFile[0]).required) === JSON.stringify(["file", "issues", "exports", "imports_used", "summary"]),
);
const integ = argv.find((a) => JSON.stringify(Object.keys(schemaOf(a).properties)) === JSON.stringify(["cross_file_issues"]));
check("integration pass KHÔNG nhận code (không có dòng đánh số kiểu '  1| ')", !!integ && !/^\s*\d+\| /m.test(opt(integ, "-p")!));
const digest = integ ? (JSON.parse(opt(integ, "-p")!) as Record<string, unknown>[]) : [];
check(
  "integration pass nhận summary/exports/imports_used của 12 file",
  digest.length === 12 && JSON.stringify(Object.keys(digest[0]).sort()) === JSON.stringify(["exports", "file", "imports_used", "summary"]),
);

check("parser đọc được kênh structured_output", out.includes("lấy output từ structured_output"));
check("parser đọc được kênh tool_use StructuredOutput", out.includes("lấy output từ StructuredOutput tool_use"));
check("parser đọc được JSON trong result.result", out.includes("lấy output từ result text"));
check(
  "ghi 12 file kết quả per-file + raw stream",
  readdirSync(join(OUT, "files")).filter((f) => f.endsWith(".json")).length === 12 &&
    readdirSync(join(OUT, "raw")).filter((f) => f.endsWith(".jsonl")).length === 14,
);
const cmp = JSON.parse(readFileSync(join(OUT, "compare.json"), "utf8"));
check("compare (bộ chấm bản API) chạy trên kết quả CLI: multi 8/8, 2/2", cmp.multi.per_file_found.length === 8 && cmp.multi.cross_file_found.length === 2);
check("compare: single bỏ sót theo kịch bản giả (5/8, 0/2)", cmp.single.per_file_found.length === 5 && cmp.single.cross_file_found.length === 0);
check("compare: lỗi chéo file chỉ integration bắt được = C1, C2", JSON.stringify([...cmp.cross_file_only_by_integration].sort()) === '["C1","C2"]');

// Parser báo lỗi rõ ràng khi không có output có cấu trúc.
let err = "";
try {
  extractStructured([{ type: "result", subtype: "error_max_structured_output_retries", result: "xin lỗi" }]);
} catch (e) {
  err = (e as Error).message;
}
check("parser raise khi không có structured output (nêu subtype)", err.includes("error_max_structured_output_retries"));

rmSync(OUT, { recursive: true, force: true });
if (backup) renameSync(backup, OUT);
rmSync(d, { recursive: true, force: true });
summary();
