// CLAUDE GIẢ cho test bài 3.3. KHÔNG gọi model.
// Trả lời "liệt kê CANARY" bằng chính mô hình match_rules.ts, nên chỉ kiểm được đường ống
// run_cli.sh → stream-json → report_cli.ts, KHÔNG kiểm được hành vi nạp rule thật của Claude Code.
//   - --tools chứa Read và prompt nhắc một đường dẫn → giả lập một lần Read file đó (kích hoạt rule khớp).
//   - usage.input_tokens = 15.000 (giả định phần system prompt + tool) + ký tự quy ước đã nạp / 4.
import { appendFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { canariesFor, loadedFor } from "../match_rules.ts";

const args = process.argv.slice(2);
if (process.env.FAKE_ARGV_LOG) appendFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify({ cwd: process.cwd(), args }) + "\n");
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const prompt = opt("-p") ?? "";
const tools = (opt("--tools") ?? "").split(",").filter(Boolean);

let repo = process.cwd();
while (!existsSync(join(repo, ".git")) && dirname(repo) !== repo) repo = dirname(repo);

const out = (o: unknown) => console.log(JSON.stringify(o));
out({ type: "system", subtype: "init", session_id: "fake", cwd: process.cwd(), tools });

const touched: string[] = [];
const path = prompt.match(/(?:src|terraform|routes|infrastructure)\/[\w./-]+\.\w+/)?.[0];
if (tools.includes("Read") && path) {
  touched.push(path);
  out({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: resolve(repo, path) } }] } });
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "(GIẢ) nội dung file" }] } });
}
const loaded = loadedFor(repo, touched);
const seen = canariesFor(repo, touched);
const text = seen.length ? seen.join("\n") : "NONE";
const chars = loaded.reduce((s, l) => s + l.chars, 0);
out({ type: "assistant", message: { id: "m2", content: [{ type: "text", text }] } });
out({
  type: "result",
  subtype: "success",
  result: text,
  total_cost_usd: 0,
  num_turns: touched.length ? 2 : 1,
  usage: { input_tokens: 15000 + Math.round(chars / 4), cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});
