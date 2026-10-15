// Bài 3.2 – đọc skill và command từ một thư mục .claude (project) hoặc ~/.claude (user). Không gọi model.
// Quy tắc (theo code.claude.com/docs/en/skills):
//   - skill = THƯ MỤC có SKILL.md: .claude/skills/<tên>/SKILL.md → /<tên> (field name: đổi được tên)
//   - command = file .md PHẲNG trong .claude/commands/ → /<tên file>
//   - file .md phẳng đặt thẳng trong .claude/skills/ KHÔNG tạo lệnh
//   - skill và command trùng tên: skill thắng
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export interface Frontmatter {
  [key: string]: string | undefined;
}

export interface SkillEntry {
  name: string; // tên lệnh, không có dấu "/"
  kind: "skill" | "command";
  file: string;
  frontmatter: Frontmatter;
  body: string;
}

/** Tách YAML frontmatter đơn giản (key: value một dòng, đủ cho bài tập). */
export function parseFrontmatter(text: string): { frontmatter: Frontmatter; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, body: text };
  const frontmatter: Frontmatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) frontmatter[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return { frontmatter, body: text.slice(m[0].length) };
}

/** Danh sách tool trong allowed-tools / disallowed-tools (chấp nhận cách nhau bằng dấu cách hoặc dấu phẩy, hoặc [a, b]). */
export function toolList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, "")
    .split(/[\s,]+/)
    .map((t) => t.replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

/** Đọc mọi lệnh mà một thư mục cấu hình (.claude hoặc ~/.claude) tạo ra, kèm các file "bẫy" không tạo lệnh. */
export function scanConfigDir(configDir: string): { entries: SkillEntry[]; flatInSkills: string[] } {
  const entries: SkillEntry[] = [];
  const flatInSkills: string[] = [];
  const skillsDir = join(configDir, "skills");
  if (isDir(skillsDir)) {
    for (const name of readdirSync(skillsDir).sort()) {
      const p = join(skillsDir, name);
      if (isDir(p)) {
        const f = join(p, "SKILL.md");
        if (!existsSync(f)) continue; // thư mục không có SKILL.md: không phải skill
        const { frontmatter, body } = parseFrontmatter(readFileSync(f, "utf8"));
        entries.push({ name: frontmatter.name || name, kind: "skill", file: f, frontmatter, body });
      } else if (name.endsWith(".md")) {
        flatInSkills.push(p);
      }
    }
  }
  const commandsDir = join(configDir, "commands");
  if (isDir(commandsDir)) {
    for (const name of readdirSync(commandsDir).sort()) {
      if (!name.endsWith(".md")) continue;
      const f = join(commandsDir, name);
      const { frontmatter, body } = parseFrontmatter(readFileSync(f, "utf8"));
      entries.push({ name: basename(name, ".md"), kind: "command", file: f, frontmatter, body });
    }
  }
  return { entries, flatInSkills };
}

/** Gộp theo tên: skill thắng command cùng tên (cùng một nguồn). */
export function effectiveCommands(entries: SkillEntry[]): Map<string, SkillEntry> {
  const out = new Map<string, SkillEntry>();
  for (const e of entries) {
    const cur = out.get(e.name);
    if (!cur || (cur.kind === "command" && e.kind === "skill")) out.set(e.name, e);
  }
  return out;
}
