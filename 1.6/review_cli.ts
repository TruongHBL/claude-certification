// Bài 1.6 – bản chạy bằng Claude Code CLI (phiên đăng nhập claude.ai, KHÔNG cần API key).
//
// Khác bản API (bai_1_6_multipass_review.ts):
//   - Ép schema bằng `claude -p --json-schema <schema>` thay cho tool_choice {type:"tool"}.
//     CLI tự kiểm output theo schema và trả kết quả trong field `structured_output` của message result.
//   - Mỗi pass là một lệnh `claude -p` riêng (không chung context) → pass per-file thật sự cô lập.
//   - --tools "" tắt tool built-in: code đã nằm sẵn trong prompt, agent không cần (và không được) tự đọc file.
// Giữ nguyên: schema, quy tắc review, cách đánh số dòng, integration chỉ nhận summary/exports/imports,
// bộ chấm compare() — tất cả import thẳng từ bản API.
//
// Dùng (run_cli.sh gọi các lệnh này):
//   node --experimental-strip-types review_cli.ts list            in tên 12 file (cho xargs -P 4)
//   node --experimental-strip-types review_cli.ts file <tên>      pass per-file cho 1 file
//   node --experimental-strip-types review_cli.ts single          single-pass: 1 lệnh cho cả 12 file
//   node --experimental-strip-types review_cli.ts integrate       gộp kết quả per-file + integration pass → multi.json
//   node --experimental-strip-types review_cli.ts compare         chấm single.json và multi.json với ANSWER_KEY.json
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StreamEvent } from "../lib/cli_stream.ts";
import {
  FILE_REVIEW_TOOL, INTEGRATION_SYSTEM, INTEGRATION_TOOL, PER_FILE_SYSTEM, SINGLE_SYSTEM, SINGLE_TOOL,
  compare, digestOf, loadFiles, numbered, singlePrompt, type FileReview, type ReviewResult,
} from "./bai_1_6_multipass_review.ts";

const CLI_OUT = join(import.meta.dirname, "bai_1_6_results_cli");
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const CLI_MODEL = process.env.MODEL ?? "haiku";
const BUDGET = process.env.BUDGET ?? "0.3";

type Json = Record<string, any>;

// Lấy JSON có cấu trúc từ stream-json. Chịu 3 khả năng, theo thứ tự ưu tiên:
//   1. result.structured_output   (field có trong kiểu SDKResultMessage của Agent SDK và trong binary CLI 2.1.296)
//   2. input của tool_use tên StructuredOutput (CLI hiện thực --json-schema bằng một tool nội bộ tên này)
//   3. JSON trong result.result (văn bản, có thể bọc ```json)
// Mới đọc từ type definition + chuỗi trong binary, CHƯA kiểm chứng bằng lần chạy thật.
export function extractStructured(events: StreamEvent[]): [Json, string, Json] {
  const result: Json = events.findLast((e) => e.type === "result") ?? {};
  const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
  if (isObj(result.structured_output)) return [result.structured_output, "structured_output", result];

  const tool = events
    .filter((e) => e.type === "assistant")
    .flatMap((e) => (Array.isArray(e.message?.content) ? e.message!.content : []))
    .findLast((b: Json) => b.type === "tool_use" && b.name === "StructuredOutput");
  if (tool && isObj(tool.input)) return [tool.input, "StructuredOutput tool_use", result];

  const text = String(result.result ?? "").trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(text);
    if (isObj(parsed)) return [parsed, "result text", result];
  } catch {
    // không phải JSON → báo lỗi bên dưới
  }
  throw new Error(`Không lấy được structured output (subtype=${JSON.stringify(result.subtype ?? null)})`);
}

// Một lệnh `claude -p` ép schema → object. Lưu stream thô cạnh kết quả để soát lại.
function cliStructuredCall(label: string, system: string, schema: object, userText: string): Json {
  mkdirSync(join(CLI_OUT, "raw"), { recursive: true });
  const args = ["-p", userText,
    "--model", CLI_MODEL,
    "--system-prompt", system,
    "--json-schema", JSON.stringify(schema),
    "--tools", "",
    "--permission-mode", "dontAsk",
    "--max-budget-usd", BUDGET,
    "--no-session-persistence",
    "--output-format", "stream-json", "--verbose"];
  // Chạy trong thư mục kết quả để không nạp CLAUDE.md/settings của project nào.
  const r = spawnSync(CLAUDE_BIN, args, { cwd: CLI_OUT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  writeFileSync(join(CLI_OUT, "raw", `${label}.jsonl`), r.stdout);
  if (r.stderr) writeFileSync(join(CLI_OUT, "raw", `${label}.err`), r.stderr);
  const events = r.stdout.split("\n").flatMap((l) => {
    try {
      return l.trim() ? [JSON.parse(l) as StreamEvent] : [];
    } catch {
      return [];
    }
  });
  const [data, source, result] = extractStructured(events);
  console.error(
    `[${label}] lấy output từ ${source} · cost ${result.total_cost_usd ?? "?"} USD${r.status === 0 ? "" : ` · mã lỗi ${r.status}`}`,
  );
  return structuredClone(data);
}

function saveCli(rel: string, data: unknown) {
  const path = join(CLI_OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

const loadCli = <T>(rel: string) => JSON.parse(readFileSync(join(CLI_OUT, rel), "utf8")) as T;

function cliPerFile(name: string) {
  const code = new Map(loadFiles()).get(name);
  if (code === undefined) throw new Error(`Không có file ${name}`);
  const r = cliStructuredCall(`file_${name}`, PER_FILE_SYSTEM, FILE_REVIEW_TOOL.input_schema, numbered(name, code));
  saveCli(`files/${name}.json`, { ...r, file: name }); // tên file lấy từ code, không tin model
}

function cliSingle() {
  saveCli("single.json", cliStructuredCall("single", SINGLE_SYSTEM, SINGLE_TOOL.input_schema, singlePrompt(loadFiles())));
}

function cliIntegrate() {
  const reviews = loadFiles()
    .map(([n]) => loadCli<FileReview>(`files/${n}.json`))
    .sort((a, b) => a.file.localeCompare(b.file));
  // KHÔNG gửi lại code: chỉ summary/exports/imports_used
  const r = cliStructuredCall("integration", INTEGRATION_SYSTEM, INTEGRATION_TOOL.input_schema, JSON.stringify(digestOf(reviews), null, 2));
  saveCli("multi.json", { files: reviews, cross_file_issues: r.cross_file_issues });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "list") for (const [n] of loadFiles()) console.log(n);
  else if (cmd === "file") {
    if (!arg) throw new Error("Thiếu tên file");
    cliPerFile(arg);
  } else if (cmd === "single") cliSingle();
  else if (cmd === "integrate") cliIntegrate();
  else if (cmd === "compare") saveCli("compare.json", compare(loadCli<ReviewResult>("single.json"), loadCli<ReviewResult>("multi.json")));
  else {
    console.error("Dùng: node --experimental-strip-types review_cli.ts list|file <tên>|single|integrate|compare");
    process.exitCode = 1;
  }
}
