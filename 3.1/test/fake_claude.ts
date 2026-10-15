// CLAUDE GIẢ cho test bài 3.1. KHÔNG gọi model.
// Trả lời câu hỏi "liệt kê CANARY" bằng chính mô hình expected_loading.ts (nên chỉ kiểm được đường ống
// run_cli.sh → stream-json → report_cli.ts, KHÔNG kiểm được hành vi nạp file thật của Claude Code).
//   - user-level: đọc file ở FAKE_USER_CLAUDE_MD (không bao giờ đọc ~/.claude/CLAUDE.md thật);
//     bị bỏ khi có --setting-sources mà không chứa "user".
//   - có --tools chứa Read và prompt nhắc tới một đường dẫn → giả lập một lần Read (kích hoạt on-demand).
import { appendFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expectedLoading } from "../expected_loading.ts";

const args = process.argv.slice(2);
if (process.env.FAKE_ARGV_LOG) appendFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify({ cwd: process.cwd(), args }) + "\n");
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const prompt = opt("-p") ?? "";
const sources = opt("--setting-sources");
const userFile = process.env.FAKE_USER_CLAUDE_MD;
const userLevel = !!userFile && (sources === undefined || sources.split(",").includes("user"));

let repoRoot = process.cwd();
while (!existsSync(join(repoRoot, ".git")) && dirname(repoRoot) !== repoRoot) repoRoot = dirname(repoRoot);

const out = (o: unknown) => console.log(JSON.stringify(o));
out({ type: "system", subtype: "init", session_id: "fake", cwd: process.cwd(), tools: (opt("--tools") ?? "").split(",").filter(Boolean) });

const reads: string[] = [];
const path = prompt.match(/[\w./-]+\.ts\b/)?.[0];
if ((opt("--tools") ?? "").split(",").includes("Read") && path) {
  const abs = resolve(process.cwd(), path);
  reads.push(abs);
  out({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: abs } }] } });
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "(GIẢ) nội dung file" }] } });
}
const loaded = expectedLoading({ repoRoot, cwd: process.cwd(), userLevel, userClaudeMd: userFile, readFiles: reads });
const canaries = loaded.map((l) => l.canary).filter((c): c is string => !!c);
const text = canaries.length ? canaries.join("\n") : "NONE";
out({ type: "assistant", message: { id: "m2", content: [{ type: "text", text }] } });
out({ type: "result", subtype: "success", result: text, total_cost_usd: 0, num_turns: reads.length ? 2 : 1 });
