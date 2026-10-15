// Bài 3.2 – mô hình tĩnh "phiên nào thấy lệnh nào" (bước 5: ranh giới chia sẻ). Không gọi model.
// Nguồn lệnh của một phiên = project (.claude/ trong repo, đi theo git) + user (~/.claude/, chỉ máy mình).
// Trùng tên giữa các nguồn: personal thắng project (docs: "Enterprise over personal, and personal over project").
// Dùng: node --experimental-strip-types expected_commands.ts [repo] [personal-skills-dir]
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveCommands, scanConfigDir, type SkillEntry } from "./skill_files.ts";

export interface Visible {
  name: string;
  source: "project" | "user";
  kind: SkillEntry["kind"];
  fork: boolean;
}

/** userConfigDir: thư mục kiểu ~/.claude của máy đó (có skills/, commands/); undefined = máy người mới clone. */
export function visibleCommands(repo: string, userConfigDir?: string): Visible[] {
  const proj = effectiveCommands(scanConfigDir(join(repo, ".claude")).entries);
  const user = userConfigDir ? effectiveCommands(scanConfigDir(userConfigDir).entries) : new Map<string, SkillEntry>();
  const merged = new Map<string, Visible>();
  for (const [n, e] of proj) merged.set(n, { name: n, source: "project", kind: e.kind, fork: e.frontmatter.context === "fork" });
  for (const [n, e] of user) merged.set(n, { name: n, source: "user", kind: e.kind, fork: e.frontmatter.context === "fork" });
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Bảng so sánh cho các lệnh của bài tập. */
export function table(repo: string, personalConfigDir: string): { name: string; newcomer: boolean; me: boolean }[] {
  const names = ["review", "analyse-feature", "lint", "brainstorm"];
  const fresh = new Set(visibleCommands(repo).map((v) => v.name));
  const mine = new Set(visibleCommands(repo, personalConfigDir).map((v) => v.name));
  return names.map((name) => ({ name, newcomer: fresh.has(name), me: mine.has(name) }));
}

/** Dựng một thư mục giả lập ~/.claude chỉ chứa skills/brainstorm (copy từ personal/). Không đụng ~/.claude thật. */
export function fakeUserConfig(personalDir: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cca32-home-"));
  cpSync(join(personalDir, "brainstorm"), join(dir, "skills", "brainstorm"), { recursive: true });
  return dir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const here = import.meta.dirname;
  const repo = process.argv[2] ?? join(here, "demo-repo");
  const personal = process.argv[3] ?? fakeUserConfig(join(here, "personal"));
  console.log("Lệnh          Người mới clone   Máy mình (có skill cá nhân)");
  for (const r of table(repo, personal)) {
    console.log(`/${r.name.padEnd(16)} ${(r.newcomer ? "có" : "KHÔNG").padEnd(17)} ${r.me ? "có" : "KHÔNG"}`);
  }
  console.log("\n/lint không có ở đâu cả: .claude/skills/lint.md là file phẳng, không tạo lệnh.");
}
