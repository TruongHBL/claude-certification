// Bài 3.1 – kiểm tĩnh cấu hình CLAUDE.md của một repo. Không gọi model.
//   ERROR: dùng từ khoá "@import" (không tồn tại, cú pháp đúng là "@đường/dẫn")
//          import trỏ tới file không tồn tại (đường dẫn tính từ FILE chứa import)
//          có CLAUDE.local.md nhưng .gitignore không bỏ qua nó (sẽ bị commit)
//   WARN : file > 200 dòng (tài liệu: tốn context, giảm mức tuân thủ)
//          import lồng quá 4 bước
//          quy tắc "cứng" (NEVER, MUST NOT, tuyệt đối không, cấm…): CLAUDE.md chỉ là hướng dẫn, quy tắc
//          bắt buộc nên chuyển sang settings.json (permissions.deny) hoặc hook PreToolUse
//          có CLAUDE.local.md.example nhưng .gitignore chưa có CLAUDE.local.md
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { importsOf, MAX_IMPORT_DEPTH } from "./expected_loading.ts";

export interface Finding {
  level: "ERROR" | "WARN";
  file: string;
  line?: number;
  msg: string;
}

const MAX_LINES = 200;
const HARD_RULE = /\b(NEVER|MUST NOT|MUST|ALWAYS)\b|tuyệt đối không|không bao giờ|\bcấm\b/i;

/** Mọi file hướng dẫn trong repo (bỏ node_modules, .git). */
export function memoryFiles(repo: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^CLAUDE(\.local)?\.md$/.test(e.name) || (p.includes(join(".claude", "rules")) && e.name.endsWith(".md"))) out.push(p);
    }
  };
  walk(repo);
  return out.sort();
}

function gitignored(repo: string, name: string): boolean {
  const gi = join(repo, ".gitignore");
  return existsSync(gi) && readFileSync(gi, "utf8").split("\n").some((l) => l.trim() === name || l.trim() === `/${name}` || l.trim() === `**/${name}`);
}

export function lintRepo(repo: string): Finding[] {
  const root = resolve(repo);
  const rel = (f: string) => relative(root, f);
  const out: Finding[] = [];

  const depthOf = (file: string, seen = new Set<string>()): number => {
    if (seen.has(file) || !existsSync(file)) return 0;
    seen.add(file);
    return Math.max(0, ...importsOf(file).map((i) => 1 + depthOf(resolve(dirname(file), i.raw), seen)));
  };

  for (const f of memoryFiles(root)) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((text, i) => {
      if (/^\s*@import\b/.test(text))
        out.push({ level: "ERROR", file: rel(f), line: i + 1, msg: 'dùng "@import": không có từ khoá này, viết "@đường/dẫn/file.md"' });
      if (HARD_RULE.test(text))
        out.push({ level: "WARN", file: rel(f), line: i + 1, msg: "quy tắc bắt buộc: CLAUDE.md không đảm bảo tuân thủ, nên chặn bằng settings.json (permissions.deny) hoặc hook PreToolUse" });
    });
    for (const imp of importsOf(f)) {
      const target = resolve(dirname(f), imp.raw);
      if (!existsSync(target))
        out.push({ level: "ERROR", file: rel(f), line: imp.line, msg: `import @${imp.raw} không tồn tại (tính từ ${rel(dirname(f)) || "."}/ → ${rel(target)})` });
    }
    if (lines.length > MAX_LINES) out.push({ level: "WARN", file: rel(f), msg: `${lines.length} dòng (> ${MAX_LINES}): tách bằng .claude/rules/ có paths (bài 3.3) để giảm context` });
    const depth = depthOf(f);
    if (depth > MAX_IMPORT_DEPTH) out.push({ level: "WARN", file: rel(f), msg: `import lồng ${depth} bước (tối đa ${MAX_IMPORT_DEPTH})` });
  }

  if (existsSync(join(root, "CLAUDE.local.md")) && !gitignored(root, "CLAUDE.local.md"))
    out.push({ level: "ERROR", file: "CLAUDE.local.md", msg: ".gitignore chưa bỏ qua CLAUDE.local.md: ghi chú cá nhân sẽ bị commit" });
  else if (existsSync(join(root, "CLAUDE.local.md.example")) && !gitignored(root, "CLAUDE.local.md"))
    out.push({ level: "WARN", file: ".gitignore", msg: "nên thêm CLAUDE.local.md vào .gitignore" });
  return out.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.argv[2] ?? join(import.meta.dirname, "demo-repo");
  const found = lintRepo(repo);
  console.log(`Lint ${repo}: ${memoryFiles(repo).length} file hướng dẫn`);
  for (const f of found) console.log(`  ${f.level.padEnd(5)} ${f.file}${f.line ? `:${f.line}` : ""}  ${f.msg}`);
  const errors = found.filter((f) => f.level === "ERROR").length;
  console.log(`${errors} lỗi, ${found.length - errors} cảnh báo`);
  process.exitCode = errors ? 1 : 0;
}
