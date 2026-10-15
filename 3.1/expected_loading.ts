// Bài 3.1 – mô hình TĨNH: đứng ở thư mục X thì Claude Code nạp những file hướng dẫn nào, theo thứ tự nào.
// Không gọi model. Dựa trên tài liệu code.claude.com/docs/en/memory (đọc ngày 15/10/2026):
//   - Thứ tự: managed → user (~/.claude/CLAUDE.md) → project → local. "All discovered files are concatenated
//     into context rather than overriding each other": nạp sau KHÔNG có nghĩa là thắng.
//   - Lúc khởi động: CLAUDE.md và CLAUDE.local.md ở cwd và MỌI thư mục phía trên, từ gốc xuống cwd.
//     CLAUDE.local.md đứng sau CLAUDE.md cùng cấp.
//   - Thư mục CON của cwd: nạp ON-DEMAND, khi Claude đọc/ghi/sửa một file trong thư mục đó.
//   - `@path` import: nạp NGAY (eager), đường dẫn tương đối tính từ file chứa dòng import, tối đa 4 bước lồng.
//   - .claude/rules/*.md không có frontmatter `paths`: nạp lúc khởi động như .claude/CLAUDE.md.
// Chỗ CHƯA CHẮC (ghi trong trang nộp): `.claude/CLAUDE.md` và `.claude/rules/` ở thư mục TỔ TIÊN của cwd có được nạp
// không. Tài liệu chỉ nói "CLAUDE.md và CLAUDE.local.md ở mọi thư mục phía trên"; mô hình này giả định có.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

export const CANARY_RE = /CANARY-[A-Z0-9]+(?:-[A-Z0-9]+)*/g;
export const USER_CANARY = "CANARY-USER-3H";
export const MAX_IMPORT_DEPTH = 4;

export interface Loaded {
  file: string; // đường dẫn tuyệt đối
  label: string; // hiển thị: tương đối với repo, hoặc ~/… cho user-level
  kind: "user" | "project" | "local" | "rule" | "import" | "directory";
  when: "launch" | "on-demand";
  canary?: string;
}

export interface LoadOptions {
  repoRoot: string;
  cwd: string; // tuyệt đối, nằm trong repoRoot
  userLevel: boolean; // phiên có nạp ~/.claude/CLAUDE.md (người mới clone: false)
  userClaudeMd?: string; // mặc định ~/.claude/CLAUDE.md
  readFiles?: string[]; // file Claude đọc trong phiên (tuyệt đối) → kích hoạt CLAUDE.md on-demand
}

export function canaryOf(file: string): string | undefined {
  const m = readFileSync(file, "utf8").match(CANARY_RE);
  return m?.[0];
}

/** Các dòng `@path` ngoài code span/code block, theo đúng thứ tự. */
export function importsOf(file: string): { raw: string; line: number }[] {
  const out: { raw: string; line: number }[] = [];
  let fenced = false;
  readFileSync(file, "utf8").split("\n").forEach((text, i) => {
    if (/^\s*```/.test(text)) fenced = !fenced;
    if (fenced) return;
    const noSpans = text.replace(/`[^`]*`/g, "");
    for (const m of noSpans.matchAll(/(?:^|\s)@((?:[^\s\\]|\\ )+)/g)) {
      if (m[1] === "import") continue; // từ khoá "@import" không tồn tại; lint_config.ts báo lỗi riêng
      out.push({ raw: m[1].replace(/\\ /g, " "), line: i + 1 });
    }
  });
  return out;
}

const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

function rulesOf(dir: string): string[] {
  const root = join(dir, ".claude", "rules");
  if (!existsSync(root)) return [];
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".md") ? [join(d, e.name)] : []));
  // Rule có frontmatter `paths:` chỉ nạp khi khớp file (bài 3.3), mô hình này chỉ lấy rule không có `paths`.
  return walk(root).filter((f) => !/^---\n[\s\S]*?\bpaths\s*:[\s\S]*?\n---/.test(readFileSync(f, "utf8")));
}

export function expectedLoading(o: LoadOptions): Loaded[] {
  const repoRoot = resolve(o.repoRoot);
  const cwd = resolve(o.cwd);
  const label = (f: string) => (f.startsWith(homedir() + sep) && !f.startsWith(repoRoot) ? "~/" + relative(homedir(), f) : relative(repoRoot, f));
  const out: Loaded[] = [];
  const seen = new Set<string>();

  const add = (file: string, kind: Loaded["kind"], when: Loaded["when"], depth = 0) => {
    if (seen.has(file) || !isFile(file)) return;
    seen.add(file);
    out.push({ file, label: label(file), kind, when, canary: canaryOf(file) });
    if (depth >= MAX_IMPORT_DEPTH) return;
    for (const imp of importsOf(file)) {
      const target = resolve(dirname(file), imp.raw); // tương đối với FILE chứa import, không phải cwd
      add(target, "import", when, depth + 1);
    }
  };

  if (o.userLevel) add(o.userClaudeMd ?? join(homedir(), ".claude", "CLAUDE.md"), "user", "launch");

  // Từ repoRoot xuống cwd (mô hình giới hạn trong repo; thư mục ngoài repo bỏ qua).
  const chain: string[] = [];
  for (let d = cwd; ; d = dirname(d)) {
    chain.unshift(d);
    if (d === repoRoot || d === dirname(d)) break;
  }
  for (const d of chain) {
    add(join(d, "CLAUDE.md"), d === repoRoot ? "project" : "directory", "launch");
    add(join(d, ".claude", "CLAUDE.md"), d === repoRoot ? "project" : "directory", "launch");
    for (const r of rulesOf(d)) add(r, "rule", "launch");
    add(join(d, "CLAUDE.local.md"), "local", "launch");
  }

  // On-demand: CLAUDE.md trong thư mục con của cwd, nạp khi Claude chạm vào file trong đó.
  for (const f of o.readFiles ?? []) {
    const abs = resolve(cwd, f);
    if (!abs.startsWith(cwd + sep)) continue;
    const dirs: string[] = [];
    for (let d = dirname(abs); d !== cwd && d.startsWith(cwd + sep); d = dirname(d)) dirs.unshift(d);
    for (const d of dirs) {
      add(join(d, "CLAUDE.md"), "directory", "on-demand");
      add(join(d, "CLAUDE.local.md"), "local", "on-demand");
    }
  }
  return out;
}

// CLI: in bảng cho 3 vị trí × có/không user-level.
if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = resolve(process.argv[2] ?? join(import.meta.dirname, "demo-repo"));
  const fakeUser = join(import.meta.dirname, "test", "fixtures", "user_claude.md"); // file user-level MÔ PHỎNG
  const cases: [string, string[]][] = [
    [".", []],
    ["packages/api", []],
    ["packages/web", []],
    [".", ["packages/api/src/routes.ts"]],
  ];
  for (const userLevel of [true, false]) {
    console.log(`\n=== ${userLevel ? "Phiên của mình (có user-level CLAUDE.md, mô phỏng)" : "Người mới clone (không có user-level, không có CLAUDE.local.md)"}`);
    for (const [cwd, reads] of cases) {
      const items = expectedLoading({ repoRoot: repo, cwd: join(repo, cwd), userLevel, userClaudeMd: fakeUser, readFiles: reads.map((r) => join(repo, r)) });
      console.log(`\n▶ cwd = ${cwd}${reads.length ? `, Claude đọc ${reads.join(", ")}` : ""}`);
      items.forEach((it, i) => console.log(`  ${i + 1}. [${it.when === "launch" ? "khởi động" : "on-demand"}] ${it.kind.padEnd(9)} ${it.label.padEnd(30)} ${it.canary ?? ""}`));
    }
  }
}
