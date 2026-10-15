// CLAUDE GIẢ cho test bài 3.2. KHÔNG gọi model.
// - system:init liệt kê skills/slash_commands theo mô hình expected_commands.ts (repo = cwd,
//   user-level = $FAKE_USER_CLAUDE_DIR; không bao giờ đọc ~/.claude thật).
// - prompt "/<skill> <arg>": nếu skill có context: fork → các message tool mang parent "forked-command-…";
//   không có fork → tool chạy ngay trong hội thoại chính (parent null).
// - prompt nhắc "phân tích" mà không gõ /lệnh → giả lập Claude tự gọi tool Skill (nhờ description).
// Chỉ kiểm được đường ống run_cli.sh → stream-json → report_cli.ts, KHÔNG kiểm hành vi thật của Claude Code.
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { visibleCommands } from "../expected_commands.ts";
import { scanConfigDir } from "../skill_files.ts";

const args = process.argv.slice(2);
if (process.env.FAKE_ARGV_LOG) appendFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify({ cwd: process.cwd(), args }) + "\n");
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const prompt = opt("-p") ?? "";
const cwd = process.cwd();
const out = (o: unknown) => console.log(JSON.stringify(o));

const visible = visibleCommands(cwd, process.env.FAKE_USER_CLAUDE_DIR || undefined);
const names = visible.map((v) => v.name);
out({ type: "system", subtype: "init", session_id: "fake", cwd, tools: (opt("--tools") ?? "").split(",").filter(Boolean), skills: ["superpowers:brainstorming", ...names.filter((n) => visible.find((v) => v.name === n)?.kind === "skill")], slash_commands: ["compact", ...names] });

/** Giả lập các bước khám phá của skill: Grep rồi Read từng file trong src/favorites. Trả về số ký tự đã đọc. */
function explore(parent: string | null, tag: string) {
  const dir = join(cwd, "src", "favorites");
  const files = readdirSync(dir).sort();
  let n = 0;
  const call = (name: string, input: Record<string, unknown>, result: string) => {
    const id = `${tag}-t${++n}`;
    out({ type: "assistant", parent_tool_use_id: parent, message: { id: `${tag}-m${n}`, content: [{ type: "tool_use", id, name, input }] } });
    out({ type: "user", parent_tool_use_id: parent, message: { content: [{ type: "tool_result", tool_use_id: id, content: result }] } });
  };
  call("Grep", { pattern: "favorite", path: "src" }, files.map((f) => `src/favorites/${f}`).join("\n"));
  for (const f of files) call("Read", { file_path: join(dir, f) }, readFileSync(join(dir, f), "utf8"));
}

const SUMMARY = "Favorites: lưu ♡ của user cho dự án matching.\nFile: src/favorites/favorites_repo.ts, favorites_controller.ts\nRủi ro: addFavorite không kiểm trùng (favorites_repo.ts:12)";
const slash = prompt.match(/^\/([\w-]+)\s*(.*)$/);
let text = "OK";
if (slash) {
  const name = slash[1];
  const entry = [...scanConfigDir(join(cwd, ".claude")).entries].find((e) => e.name === name);
  if (!entry) {
    text = `Unknown skill: ${name}`;
  } else if (entry.frontmatter.context === "fork") {
    const parent = `forked-command-${name}-1`;
    out({ type: "user", parent_tool_use_id: parent, message: { content: [{ type: "text", text: entry.body.replace(/\$ARGUMENTS/g, slash[2]) }] } });
    explore(parent, "fork");
    text = SUMMARY;
  } else {
    out({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "text", text: entry.body.replace(/\$ARGUMENTS/g, slash[2]) }] } });
    explore(null, "main");
    text = SUMMARY;
  }
} else if (/phân tích/i.test(prompt) && names.includes("analyse-feature")) {
  out({ type: "assistant", parent_tool_use_id: null, message: { id: "m0", content: [{ type: "tool_use", id: "skill-1", name: "Skill", input: { skill: "analyse-feature", args: "favorites" } }] } });
  explore("skill-1", "auto");
  out({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "skill-1", content: SUMMARY }] } });
  text = SUMMARY;
}
out({ type: "assistant", parent_tool_use_id: null, message: { id: "final", content: [{ type: "text", text }] } });
out({ type: "result", subtype: "success", result: text, total_cost_usd: 0, num_turns: 1 });
