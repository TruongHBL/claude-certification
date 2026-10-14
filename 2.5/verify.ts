// Kiểm kết quả refactor trong một thư mục (mặc định .work/): test của codebase còn đạt,
// không còn lời gọi/import hàm deprecated ngoài chính nó, mọi caller đã dùng processOrder(…, { validate: true }).
//   node --experimental-strip-types verify.ts [thư-mục]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CALLER_GROUPS } from "./refactor_reference.ts";

export interface VerifyResult {
  testsOk: boolean;
  testsOutput: string;
  violations: string[]; // "file:dòng: nội dung"
  callersMigrated: { group: string[]; ok: boolean }[];
  notes: string[];
}

const ALLOWED = new Set(["src/orders/legacy.ts", "src/orders/legacy.test.ts"]);
const CALL = /\b(processLegacyOrder|submitLegacyOrder)\s*\(/;
const IMPORT = /^\s*import\b.*\b(processLegacyOrder|submitLegacyOrder)\b/;

export function verify(dir: string): VerifyResult {
  const t = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "run_tests.ts"], { cwd: dir, encoding: "utf8" });
  const files = (readdirSync(join(dir, "src"), { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `src/${f}`);
  const violations: string[] = [];
  const notes: string[] = [];
  for (const f of files) {
    if (ALLOWED.has(f)) continue;
    readFileSync(join(dir, f), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return; // comment
        if (CALL.test(line) || IMPORT.test(line)) violations.push(`${f}:${i + 1}: ${line.trim()}`);
        else if (/processLegacyOrder as submitLegacyOrder/.test(line)) notes.push(`${f}:${i + 1}: barrel vẫn re-export tên cũ (không còn ai dùng thì nên xoá)`);
      });
  }
  const migrated = (f: string) =>
    existsSync(join(dir, f)) && /processOrder\([^)]*\{\s*validate:\s*true\s*\}\)/.test(readFileSync(join(dir, f), "utf8"));
  const callersMigrated = CALLER_GROUPS.map((group) => ({ group, ok: group.some(migrated) }));
  if (existsSync(join(dir, "src/orders/apply.ts")) && /applyLegacyOrder/.test(readFileSync(join(dir, "src/orders/apply.ts"), "utf8")))
    notes.push("wrapper applyLegacyOrder vẫn còn (chấp nhận được nếu thân đã gọi processOrder)");
  return { testsOk: t.status === 0, testsOutput: (t.stdout + t.stderr).trim(), violations, callersMigrated, notes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? join(import.meta.dirname, ".work");
  const r = verify(dir);
  const mark = (ok: boolean) => (ok ? "OK  " : "FAIL");
  console.log(`${mark(r.testsOk)} Test của codebase: ${r.testsOutput.split("\n").pop()}`);
  console.log(`${mark(r.violations.length === 0)} Không còn lời gọi/import hàm deprecated (${r.violations.length} chỗ)`);
  for (const v of r.violations) console.log(`       ${v}`);
  for (const c of r.callersMigrated) console.log(`${mark(c.ok)} Đã chuyển sang processOrder(…, { validate: true }): ${c.group.join(" hoặc ")}`);
  for (const n of r.notes) console.log(`note ${n}`);
  const ok = r.testsOk && r.violations.length === 0 && r.callersMigrated.every((c) => c.ok);
  console.log(ok ? "\nKẾT LUẬN: refactor đạt" : "\nKẾT LUẬN: refactor CHƯA đạt");
  process.exitCode = ok ? 0 : 1;
}
