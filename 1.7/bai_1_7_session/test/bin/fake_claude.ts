// Claude giả lập cho test run.sh — KHÔNG gọi API.
// Trả JSON giống `claude -p --output-format json` và ghi transcript giả vào CLAUDE_PROJECTS_DIR,
// để kiểm tra luồng file, việc lưu session ID, cách đọc transcript và bộ chấm compare.
// Câu trả lời viết sẵn (GIẢ): bước 4 cố ý "stale", bước 5 cố ý đúng.
import { appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

const a = process.argv.slice(2);
const dd = a.indexOf("--");
const prompt = String(a[(dd >= 0 ? dd : a.length) + 1] ?? "");
const opt = (k: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? a[i + 1] : undefined;
};
const die = (m: string): never => {
  console.error(m);
  process.exit(1);
};
if (!a.includes("-p")) die("thiếu -p");
if (opt("--allowedTools") !== "Read,Grep,Glob") die("allowedTools sai");
let sid = opt("--session-id") ?? opt("--resume");
if (a.includes("--fork-session") || !sid) sid = randomUUID();
const projects = process.env.CLAUDE_PROJECTS_DIR ?? die("thiếu CLAUDE_PROJECTS_DIR");
const dir = join(projects, process.cwd().replace(/[^a-zA-Z0-9]/g, "-"));
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

let reads: string[];
let text: string;
if (prompt.includes("Review toàn bộ")) {
  reads = readdirSync(".").filter((f) => f.endsWith(".rb")).sort();
  text = "7 vấn đề: ... legacy_login MD5 ... == timing ... rand token ... SQL injection ...";
} else if (prompt.includes("Viết summary")) {
  reads = [];
  text = "| File | Vấn đề | Mức độ | Đề xuất |\n|---|---|---|---|\n| auth.rb | so sánh == | High | dùng secure_compare |\n| auth.rb | legacy_login MD5 | High | xoá legacy_login |\n| session.rb | rand | High | dùng SecureRandom |\n| middleware.rb | SQL injection | Critical | dùng placeholder |\n";
} else if (prompt.includes("quay lại")) {
  reads = [];
  text = "Còn tồn tại:\n1. auth.rb: legacy_login dùng MD5, nên xoá.\n2. auth.rb: nên dùng ActiveSupport secure_compare thay ==.\n3. session.rb: nên dùng SecureRandom thay rand.\n4. middleware.rb: SQL injection trong find_tenant.";
} else if (prompt.includes("CHỈ đọc lại")) {
  reads = ["auth.rb", "session.rb", "middleware.rb"];
  text = "auth.rb: đã chuyển sang secure_compare, method cũ đã bị xoá → hết vấn đề.\nsession.rb: đã dùng SecureRandom → hết vấn đề.\nmiddleware.rb: SQL injection vẫn còn; MỚI: log ghi header Authorization (lộ token).";
} else {
  reads = [];
  text = "Kế hoạch Devise 5 bước ...";
}

const tr = join(dir, `${sid}.jsonl`);
const w = (o: unknown) => appendFileSync(tr, JSON.stringify(o) + "\n");
w({ type: "user", message: { role: "user", content: prompt } });
for (const r of reads) w({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: resolve(r) } }] } });
w({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
console.log(JSON.stringify({ type: "result", subtype: "success", session_id: sid, result: text, total_cost_usd: 0.0123, num_turns: reads.length + 1 }));
