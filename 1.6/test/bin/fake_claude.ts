#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// CLAUDE GIẢ cho test bản CLI bài 1.6. KHÔNG gọi model.
// Kết quả review được DỰNG TỪ ANSWER_KEY.json (single-pass cố tình bỏ sót vài lỗi) chỉ để kiểm tra
// đường chạy run_cli.sh → review_cli.ts → parser → compare. Không nói gì về hành vi của Claude.
// Để kiểm parser, mỗi file trả output qua một "kênh" khác nhau:
//   số thứ tự file chia 3 dư 0 → result.structured_output; dư 1 → tool_use StructuredOutput; dư 2 → JSON trong result.result
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (process.env.FAKE_ARGV_LOG) appendFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify(args) + "\n");
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const prompt = opt("-p") ?? "";
const schema = JSON.parse(opt("--json-schema")!) as { properties: Record<string, unknown> };
interface Bug { scope: string; file: string; files: string[]; line: number; severity: string; type: string; description: string }
const key = (JSON.parse(readFileSync(join(import.meta.dirname, "../../bai_1_6_sample/ANSWER_KEY.json"), "utf8")) as { bugs: Bug[] }).bugs;
const issue = (b: Bug) => ({ line: b.line, severity: b.severity, type: b.type, description: `(GIẢ) ${b.description}` });
const cross = (b: Bug) => ({ files: b.files, severity: b.severity, type: b.type, description: `(GIẢ) ${b.description}` });
const props = Object.keys(schema.properties);

let data: Record<string, unknown>;
let channel: number;
if (props.includes("exports")) {
  // per-file
  const name = prompt.match(/=== (\S+) ===/)![1];
  const idx = parseInt(name, 10);
  data = {
    file: name,
    issues: key.filter((b) => b.scope === "per_file" && b.file === name).map(issue),
    exports: [{ name: `f${idx}`, signature: `f${idx}()`, returns: "object" }],
    imports_used: [],
    summary: `(GIẢ) tóm tắt ${name}`,
  };
  channel = idx % 3;
} else if (props.includes("files")) {
  // single-pass: bỏ sót lỗi ở nửa sau, không thấy lỗi chéo file
  const seen = key.filter((b) => b.scope === "per_file" && parseInt(b.file, 10) <= 7);
  const files = [...new Set(seen.map((b) => b.file))].map((f) => ({ file: f, issues: seen.filter((b) => b.file === f).map(issue) }));
  data = { files, cross_file_issues: [] };
  channel = 0;
} else {
  // integration
  data = { cross_file_issues: key.filter((b) => b.scope === "cross_file").map(cross) };
  channel = 1;
}

const out = (o: unknown) => console.log(JSON.stringify(o));
out({ type: "system", subtype: "init", tools: channel === 1 ? ["StructuredOutput"] : [] });
if (channel === 1) {
  out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "StructuredOutput", input: data }] } });
  out({ type: "result", subtype: "success", result: "", total_cost_usd: 0 });
} else if (channel === 2) {
  out({ type: "result", subtype: "success", result: "```json\n" + JSON.stringify(data, null, 2) + "\n```", total_cost_usd: 0 });
} else {
  out({ type: "result", subtype: "success", result: "", structured_output: data, total_cost_usd: 0 });
}
