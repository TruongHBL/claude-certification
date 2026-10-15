// Bài 3.3 – lint cấu hình quy ước: bắt các anti-pattern của bài path-specific rules.
//
//   WARN  frontmatter hỏng → tài liệu: bị bỏ qua, rule nạp MỌI phiên (mất tác dụng giới hạn theo path)
//   WARN  `paths` không khớp file nào (glob gõ sai, vd *.tset.ts) → rule không bao giờ được nạp
//   WARN  nhiều CLAUDE.md thư mục có nội dung gần giống nhau → nên gộp thành 1 rule + glob
//   WARN  pattern có brace vượt ngân sách 1.000 pattern sau khi mở → Claude Code dùng nguyên văn, không khớp gì
//   INFO  root CLAUDE.md có quy ước theo LOẠI FILE (test, terraform, controller…) → nên chuyển sang rule có paths
//   INFO  rule trông như QUY TRÌNH nhiều bước → nên là skill (bài 3.2), không phải quy ước nền
//   INFO  field frontmatter khác `paths` → bị bỏ qua (paths là field duy nhất Claude Code đọc)
//
// Dùng: node --experimental-strip-types lint_rules.ts [repo]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expandBraces, listFiles, loadRules, matchGlob } from "./match_rules.ts";

export interface Finding {
  level: "WARN" | "INFO";
  file: string;
  message: string;
}

const FILE_TYPE_HINT = /\.test\.|\.spec\.|\*\.tf\b|terraform|\.controller\.|file test|test file|migration file|quy ước (test|api)|hạ tầng/i;
const STEP_LINE = /^\s*(\d+[.)]|bước\s*\d+|step\s*\d+)/i;

function normalize(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith("#") && !/canary-/i.test(l));
}

function similarity(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  return inter / Math.max(1, Math.min(sa.size, sb.size));
}

export function lint(repo: string): Finding[] {
  const out: Finding[] = [];
  const files = listFiles(repo);
  const codeFiles = files.filter((f) => !f.endsWith("CLAUDE.md"));

  for (const r of loadRules(repo)) {
    if (r.fm.error)
      out.push({ level: "WARN", file: r.file, message: `frontmatter hỏng (${r.fm.error}) → Claude Code bỏ frontmatter, rule nạp MỌI phiên` });
    for (const k of r.fm.ignoredFields)
      out.push({ level: "INFO", file: r.file, message: `field "${k}" bị bỏ qua: rule chỉ đọc \`paths\`` });
    if (r.fm.paths) {
      const expanded = r.fm.paths.reduce((s, p) => s + (p.includes("{") ? expandBraces(p).length : 0), 0);
      if (expanded > 1000)
        out.push({ level: "WARN", file: r.file, message: `brace mở ra ${expanded} pattern (> 1.000): pattern vượt ngân sách được dùng nguyên văn và không khớp gì` });
      for (const p of r.fm.paths)
        if (!codeFiles.some((f) => matchGlob(f, p)))
          out.push({ level: "WARN", file: r.file, message: `pattern "${p}" không khớp file nào trong repo (gõ sai glob?)` });
    }
    const steps = r.fm.body.split("\n").filter((l) => STEP_LINE.test(l)).length;
    if (steps >= 4)
      out.push({ level: "INFO", file: r.file, message: `${steps} dòng dạng "bước 1, 2, 3…": giống quy trình → nên là skill (gọi khi cần), không phải quy ước nền` });
  }

  const root = join(repo, "CLAUDE.md");
  if (existsSync(root)) {
    const hits = readFileSync(root, "utf8")
      .split("\n")
      .filter((l) => FILE_TYPE_HINT.test(l) && !l.includes(".claude/rules"));
    if (hits.length >= 2)
      out.push({
        level: "INFO",
        file: "CLAUDE.md",
        message: `${hits.length} dòng là quy ước theo loại file (vd "${hits[0].trim().slice(0, 60)}") → nạp cả khi sửa file không liên quan; nên chuyển sang .claude/rules/ có paths`,
      });
  }

  const nested = files.filter((f) => f.endsWith("/CLAUDE.md"));
  const bodies = nested.map((f) => ({ f, lines: normalize(readFileSync(join(repo, f), "utf8")) }));
  const groups: string[][] = [];
  const used = new Set<string>();
  for (const a of bodies) {
    if (used.has(a.f)) continue;
    const g = [a.f, ...bodies.filter((b) => b.f !== a.f && !used.has(b.f) && similarity(a.lines, b.lines) >= 0.8).map((b) => b.f)];
    if (g.length >= 2) {
      g.forEach((f) => used.add(f));
      groups.push(g);
    }
  }
  for (const g of groups)
    out.push({
      level: "WARN",
      file: g.map((f) => dirname(f)).join(", "),
      message: `${g.length} CLAUDE.md thư mục gần như giống nhau → bản sao sẽ lệch nhau theo thời gian; gộp thành 1 rule trong .claude/rules/ với glob`,
    });
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.argv[2] ?? join(new URL(".", import.meta.url).pathname, "demo-repo");
  const findings = lint(repo);
  console.log(`Lint ${repo}`);
  if (!findings.length) console.log("  (không có cảnh báo)");
  for (const f of findings) console.log(`  ${f.level}  ${f.file}: ${f.message}`);
  process.exitCode = findings.some((f) => f.level === "WARN") ? 1 : 0;
}
