// Test run.sh bài 1.7 với Claude GIẢ (test/bin/claude). KHÔNG gọi model.
//   THẬT : luồng file của run.sh, lưu session ID, đọc transcript (lib.ts), bộ chấm compare, kiểm tra fork.
//   GIẢ  : câu trả lời của Claude (bước 4 cố ý stale, bước 5 cố ý đúng) → chỉ chứng minh bộ chấm hoạt động.
// Chạy: node --experimental-strip-types --no-warnings test/run_sh.test.ts   (cuối test tự ./run.sh reset)
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, section, summary } from "../../../lib/check.ts";

const ROOT = join(import.meta.dirname, "..");
const env = { ...process.env, CLAUDE_BIN: join(ROOT, "test", "bin", "claude"), CLAUDE_PROJECTS_DIR: mkdtempSync(join(tmpdir(), "p17-")) };
const run = (...args: string[]) => {
  const r = spawnSync(join(ROOT, "run.sh"), args, { env, encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
};

section("bash -n");
check("run.sh không lỗi cú pháp", spawnSync("bash", ["-n", join(ROOT, "run.sh")]).status === 0);
check("run.sh không còn gọi ruby", !/\bruby\b/.test(readFileSync(join(ROOT, "run.sh"), "utf8")));

section("./run.sh all (Claude GIẢ)");
const all = run("all");
check("all chạy xong, exit 0", all.ok, all.out.slice(-400));
check("reset tạo work/ 10 file", all.out.includes("Đã tạo lại work/ (10 file)"));
const sid = readFileSync(join(ROOT, ".session_id"), "utf8").trim();
check("step1 lưu .session_id dạng UUID", /^[0-9a-f-]{36}$/.test(sid), sid);
check("lib.ts result: in session_id/cost/turns/subtype", all.out.includes(`session_id=${sid}  cost=$0.0123  turns=11  subtype=success`));
check("step2 ghi out/summary.md", existsSync(join(ROOT, "out", "summary.md")) && readFileSync(join(ROOT, "out", "summary.md"), "utf8").includes("| File |"));
check("step3 thay 3 file, có diff", ["auth.rb", "session.rb", "middleware.rb"].every((f) => existsSync(join(ROOT, "out", `diff_${f}.txt`))));
const rows = all.out.split("\n").filter((l) => /^(OK|FAIL)\s+(OK|FAIL)\s+/.test(l));
check("compare in 5 dòng kiểm tra", rows.length === 5, String(rows.length));
check("compare: step4 (stale GIẢ) FAIL 4 dòng, step5 OK cả 5",
  rows.filter((l) => l.startsWith("FAIL")).length === 4 && rows.every((l) => /^\S+\s+OK\s/.test(l)));
check("lib.ts reads: step4 không đọc file nào", all.out.includes("File đã Read — phiên gốc, riêng step4: (không đọc file nào)"));
check("lib.ts reads: step5 chỉ đọc 3 file đã đổi", all.out.includes("File đã Read — phiên mới (step5):      auth.rb, session.rb, middleware.rb"));

section("./run.sh step6 (fork)");
const s6 = run("step6");
check("step6 chạy xong", s6.ok, s6.out.slice(-300));
const m = s6.out.match(/Phiên gốc \S+: (\d+) → (\d+) dòng transcript/);
check("fork không ghi vào phiên gốc (số dòng transcript không đổi)", !!m && m[1] === m[2] && m[1] !== "0", m?.[0] ?? "");
check("lib.ts session-id: phiên fork có ID mới", s6.out.includes("khác ID gốc ✓"));

section("./run.sh reset (để lại trạng thái sạch)");
const rs = run("reset");
check("reset xong", rs.ok);
check("work/ có 10 file, không còn out/ và .session_id",
  readdirSync(join(ROOT, "work")).length === 10 && !existsSync(join(ROOT, "out")) && !existsSync(join(ROOT, ".session_id")));

summary();
