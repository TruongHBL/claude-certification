// Bài 3.2 – lint thư mục .claude: bắt các lỗi đặt skill/command hay gặp. Chạy thật, không gọi model.
// Dùng: node --experimental-strip-types lint_skills.ts <repo> [<repo> …]
//
// Về allowed-tools (chỗ đề thi và thực tế khác nhau):
//   - Đề thi (exam guide v1.0): allowed-tools GIỚI HẠN tool skill được dùng.
//   - Claude Code hiện nay: allowed-tools chỉ PRE-APPROVE (dùng không hỏi quyền) trong lượt gọi skill;
//     mọi tool khác vẫn gọi được. Giới hạn thật: disallowed-tools hoặc luật deny trong permissions.
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { effectiveCommands, scanConfigDir, toolList } from "./skill_files.ts";

export interface Finding {
  level: "lỗi" | "cảnh báo" | "ghi chú";
  file: string;
  message: string;
}

const WRITE_TOOLS = ["Write", "Edit", "Bash", "NotebookEdit"];
// Dấu hiệu skill "khám phá / nói nhiều": nên chạy trong subagent (context: fork).
const EXPLORE_RE = /\b(grep|glob|read)\b|khám phá|phân tích|brainstorm|explore|analy[sz]e|toàn bộ codebase/i;
// Dấu hiệu skill chỉ đọc.
const READ_ONLY_RE = /chỉ đọc|read-only|không sửa|không ghi/i;

export function lintRepo(repo: string): Finding[] {
  const out: Finding[] = [];
  const rel = (p: string) => relative(repo, p) || ".";
  const { entries, flatInSkills } = scanConfigDir(join(repo, ".claude"));

  for (const f of flatInSkills) {
    out.push({ level: "lỗi", file: rel(f), message: "File .md phẳng trong .claude/skills/ KHÔNG tạo lệnh. Đổi thành thư mục <tên>/SKILL.md, hoặc chuyển sang .claude/commands/." });
  }

  const byName = new Map<string, string[]>();
  for (const e of entries) byName.set(e.name, [...(byName.get(e.name) ?? []), e.kind]);
  for (const [name, kinds] of byName) {
    if (kinds.includes("skill") && kinds.includes("command")) {
      out.push({ level: "cảnh báo", file: `/${name}`, message: "Skill và command trùng tên: skill thắng, file trong .claude/commands/ bị che." });
    }
  }

  for (const e of entries) {
    const fm = e.frontmatter;
    const f = rel(e.file);
    if (!fm.description) {
      out.push({ level: "cảnh báo", file: f, message: "Thiếu description: Claude không tự chọn được skill theo yêu cầu (chỉ chạy khi gõ /lệnh); Claude Code lấy đoạn đầu thân bài thay thế." });
    }
    const exploratory = EXPLORE_RE.test(e.body) || EXPLORE_RE.test(fm.description ?? "");
    if (e.kind === "skill" && exploratory && fm.context !== "fork") {
      out.push({ level: "cảnh báo", file: f, message: "Skill khám phá/nhiều output nhưng thiếu `context: fork`: output dài sẽ đổ vào hội thoại chính." });
    }
    const allowed = toolList(fm["allowed-tools"]);
    const writes = allowed.filter((t) => WRITE_TOOLS.some((w) => t === w || t.startsWith(`${w}(`)));
    if (writes.length && (READ_ONLY_RE.test(e.body) || exploratory)) {
      out.push({ level: "cảnh báo", file: f, message: `Skill đọc/khám phá nhưng allowed-tools có ${writes.join(", ")}: chỉ nên Read Grep Glob.` });
    }
    if (allowed.length && !fm["disallowed-tools"]) {
      out.push({ level: "ghi chú", file: f, message: `allowed-tools (${allowed.join(" ")}) chỉ pre-approve trong Claude Code hiện nay, KHÔNG giới hạn. Muốn chặn thật: disallowed-tools hoặc deny trong permissions. (Đề thi coi allowed-tools là giới hạn.)` });
    }
  }

  // Quy trình nhiều bước nằm trong CLAUDE.md: nên là skill/command (nạp khi cần, không nạp mọi phiên).
  for (const md of [join(repo, "CLAUDE.md"), join(repo, ".claude", "CLAUDE.md")]) {
    if (!existsSync(md)) continue;
    const text = readFileSync(md, "utf8");
    const steps = text.split("\n").filter((l) => /^\s*\d+\.\s/.test(l)).length;
    if (steps >= 5) {
      out.push({ level: "cảnh báo", file: rel(md), message: `CLAUDE.md có quy trình ${steps} bước đánh số: quy trình theo việc nên chuyển thành skill/command (CLAUDE.md nạp mọi phiên).` });
    }
  }
  return out;
}

export function summarize(repo: string): string[] {
  const { entries } = scanConfigDir(join(repo, ".claude"));
  return [...effectiveCommands(entries).values()].map((e) => `/${e.name} (${e.kind}${e.frontmatter.context === "fork" ? ", context: fork" : ""})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repos = process.argv.slice(2);
  if (!repos.length) {
    console.error("Dùng: lint_skills.ts <repo> [<repo> …]");
    process.exit(2);
  }
  let errors = 0;
  for (const repo of repos) {
    console.log(`== ${repo}`);
    console.log(`Lệnh tạo ra: ${summarize(repo).join(", ") || "(không có)"}`);
    for (const f of lintRepo(repo)) {
      if (f.level === "lỗi") errors++;
      console.log(`  [${f.level}] ${f.file}: ${f.message}`);
    }
  }
  process.exitCode = errors ? 1 : 0;
}
