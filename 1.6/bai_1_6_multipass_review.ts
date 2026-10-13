// Bài 1.6 – Build Exercise: Multi-Pass Code Review Pipeline (bản Messages API).
//
// So sánh 2 cách review 12 file JS trong bai_1_6_sample/:
//   single  : MỘT lần gọi chứa toàn bộ 12 file → dễ bị attention dilution (file sau review nông hơn)
//   multi   : pass per-file (mỗi file 1 lần gọi, schema cố định) → pass integration chỉ nhận
//             summary/exports/imports (không nhận lại code) để tìm lỗi chéo file
//   compare : chấm cả hai bản với bai_1_6_sample/ANSWER_KEY.json
//   all     : chạy single, multi rồi compare
//
// Đây là FIXED SEQUENTIAL PIPELINE (prompt chaining): các bước định sẵn, thứ tự không đổi theo kết quả.
// Không phải dynamic decomposition (agent tự lập/sửa kế hoạch khi điều tra).
//
// Module này cũng là phần dùng chung cho bản CLI (review_cli.ts): schema, quy tắc review,
// cách đánh số dòng và bộ chấm compare().
//
// Chạy:  export ANTHROPIC_API_KEY=...
//        node --experimental-strip-types bai_1_6_multipass_review.ts all
// Không có API key: dùng bản CLI (./run_cli.sh all).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { httpTransport, type Tool, type Transport } from "../lib/anthropic.ts";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
export const SAMPLE_DIR = join(import.meta.dirname, "bai_1_6_sample");
const OUT_DIR = join(import.meta.dirname, "bai_1_6_results");
const PARALLEL = 4; // số pass per-file chạy cùng lúc
const LINE_TOLERANCE = 3;

const ISSUE_TYPES = ["sql_injection", "null_deref", "async_foreach", "missing_await", "off_by_one",
  "signature_mismatch", "field_mismatch", "other"];

const ISSUE_SCHEMA = {
  type: "object",
  properties: {
    line: { type: "integer", description: "Số dòng (theo số đánh ở đầu dòng)" },
    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
    type: { type: "string", enum: ISSUE_TYPES },
    description: { type: "string" },
  },
  required: ["line", "severity", "type", "description"],
};

const CROSS_ISSUE_SCHEMA = {
  type: "object",
  properties: {
    files: { type: "array", items: { type: "string" }, description: "Các file liên quan (≥ 2)" },
    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
    type: { type: "string", enum: ISSUE_TYPES },
    description: { type: "string" },
  },
  required: ["files", "severity", "type", "description"],
};

// Pass per-file: ép đúng schema bằng tool bắt buộc (tool_choice type "tool").
export const FILE_REVIEW_TOOL: Tool = {
  name: "report_file_review",
  description: "Nộp kết quả review cho ĐÚNG MỘT file.",
  input_schema: {
    type: "object",
    properties: {
      file: { type: "string" },
      issues: { type: "array", items: ISSUE_SCHEMA },
      exports: {
        type: "array",
        description: "Mọi hàm/hằng file này export, kèm chữ ký và hình dạng giá trị trả về",
        items: {
          type: "object",
          properties: { name: { type: "string" }, signature: { type: "string" }, returns: { type: "string" } },
          required: ["name", "signature", "returns"],
        },
      },
      imports_used: {
        type: "array",
        description: "Mọi chỗ dùng thứ import từ file khác: gọi thế nào, đọc field nào của kết quả",
        items: {
          type: "object",
          properties: {
            from: { type: "string" }, name: { type: "string" }, call: { type: "string" },
            fields_used: { type: "array", items: { type: "string" } },
          },
          required: ["from", "name", "call", "fields_used"],
        },
      },
      summary: { type: "string", description: "1–3 câu: file làm gì" },
    },
    required: ["file", "issues", "exports", "imports_used", "summary"],
  },
};

export const SINGLE_TOOL: Tool = {
  name: "report_review",
  description: "Nộp kết quả review cho TẤT CẢ các file.",
  input_schema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          properties: { file: { type: "string" }, issues: { type: "array", items: ISSUE_SCHEMA } },
          required: ["file", "issues"],
        },
      },
      cross_file_issues: { type: "array", items: CROSS_ISSUE_SCHEMA },
    },
    required: ["files", "cross_file_issues"],
  },
};

export const INTEGRATION_TOOL: Tool = {
  name: "report_integration",
  description: "Nộp các lỗi chỉ thấy được khi đối chiếu nhiều file.",
  input_schema: {
    type: "object",
    properties: { cross_file_issues: { type: "array", items: CROSS_ISSUE_SCHEMA } },
    required: ["cross_file_issues"],
  },
};

export const REVIEW_RULES =
  "Tìm lỗi thật (bảo mật, crash, sai logic, async), không bắt lỗi văn phong.\n" +
  "Ghi đúng số dòng theo số đánh ở đầu mỗi dòng. Dùng type trong danh sách cho sẵn.\n";

export const SINGLE_SYSTEM = `Bạn là reviewer JS. ${REVIEW_RULES}`;
export const PER_FILE_SYSTEM =
  `Bạn là reviewer JS. Chỉ review ĐÚNG MỘT file được đưa. ${REVIEW_RULES}` +
  "Liệt kê đủ exports (chữ ký, hình dạng giá trị trả về) và imports_used (cách gọi, field đọc từ kết quả): " +
  "pass sau dùng chúng để đối chiếu chéo file mà không đọc lại code.";
export const INTEGRATION_SYSTEM =
  "Bạn kiểm tra tích hợp giữa các module. Chỉ có bản tóm tắt từng file (không có code). " +
  "Tìm chỗ export và nơi dùng không khớp: chữ ký hàm, tên field, kiểu trả về, luồng dữ liệu. " +
  "Không lặp lại lỗi nội bộ một file.";

// ---------- Kiểu kết quả ----------
export interface Issue { line: number; severity: string; type: string; description: string }
export interface CrossIssue { files: string[]; severity: string; type: string; description: string }
export interface FileReview {
  file: string;
  issues: Issue[];
  exports?: unknown[];
  imports_used?: unknown[];
  summary?: string;
}
export interface ReviewResult { files: FileReview[]; cross_file_issues: CrossIssue[] }
interface Bug { id: string; scope: "per_file" | "cross_file"; file: string; line: number; type: string; files: string[] }

export type SourceFile = [name: string, code: string];

export function loadFiles(): SourceFile[] {
  return readdirSync(SAMPLE_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort()
    .map((f) => [f, readFileSync(join(SAMPLE_DIR, f), "utf8")]);
}

export function numbered(name: string, code: string): string {
  const lines = code.split(/(?<=\n)/); // giữ ký tự xuống dòng ở cuối mỗi dòng
  const body = lines.map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("");
  return `=== ${name} ===\n${body}`;
}

/** Digest gửi cho integration pass: chỉ summary/exports/imports, KHÔNG gửi lại code. */
export const digestOf = (reviews: FileReview[]) =>
  reviews.map(({ file, summary, exports, imports_used }) => ({ file, summary, exports, imports_used }));

export const singlePrompt = (files: SourceFile[]) =>
  `Review toàn bộ ${files.length} file sau.\n\n` + files.map(([n, c]) => numbered(n, c)).join("\n\n");

// Một lần gọi bắt buộc dùng tool → trả về input của tool.
async function forcedToolCall<T>(transport: Transport, system: string, tool: Tool, userText: string, maxTokens = 8192): Promise<T> {
  const r = await transport({
    model: MODEL, max_tokens: maxTokens, system,
    tools: [tool], tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: userText }],
  });
  if (r.stop_reason === "max_tokens") throw new Error(`Output bị cắt (max_tokens) ở ${tool.name}`);

  const blk = r.content.find((b) => b.type === "tool_use" && b.name === tool.name);
  if (!blk || blk.type !== "tool_use") throw new Error(`Không có tool_use ${tool.name}`);
  return structuredClone(blk.input) as T;
}

// ---------- Cách 1: single-pass ----------
export const singlePass = (files: SourceFile[], transport: Transport) =>
  forcedToolCall<ReviewResult>(transport, SINGLE_SYSTEM, SINGLE_TOOL, singlePrompt(files), 16_000);

// ---------- Cách 2: multi-pass ----------
async function perFilePass(transport: Transport, name: string, code: string): Promise<FileReview> {
  const r = await forcedToolCall<FileReview>(transport, PER_FILE_SYSTEM, FILE_REVIEW_TOOL, numbered(name, code));
  return { ...r, file: name }; // tên file lấy từ code, không tin model
}

const integrationPass = (transport: Transport, reviews: FileReview[]) =>
  forcedToolCall<{ cross_file_issues: CrossIssue[] }>(
    transport, INTEGRATION_SYSTEM, INTEGRATION_TOOL, JSON.stringify(digestOf(reviews), null, 2),
  );

/** Chạy fn trên từng phần tử, tối đa `limit` cái cùng lúc (Promise pool). */
async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function multiPass(files: SourceFile[], transport: Transport): Promise<ReviewResult> {
  const reviews = (await pool(files, PARALLEL, ([name, code]) => perFilePass(transport, name, code)))
    .sort((a, b) => a.file.localeCompare(b.file));
  return { files: reviews, cross_file_issues: (await integrationPass(transport, reviews)).cross_file_issues };
}

// ---------- Chấm điểm ----------
function foundPerFile(result: ReviewResult, bug: Bug): boolean {
  const entry = result.files.find((f) => f.file === bug.file) ?? { issues: [] };
  return entry.issues.some((i) => i.type === bug.type && Math.abs(Number(i.line) - bug.line) <= LINE_TOLERANCE);
}

const foundCross = (result: ReviewResult, bug: Bug) =>
  result.cross_file_issues.some((c) => c.type === bug.type && bug.files.every((f) => c.files.includes(f)));

function score(result: ReviewResult, key: Bug[], files: SourceFile[]) {
  const per = key.filter((b) => b.scope === "per_file");
  const cross = key.filter((b) => b.scope === "cross_file");
  const depth = files.map(([name]) => {
    const issues = (result.files.find((f) => f.file === name) ?? { issues: [] }).issues;
    const avg = issues.length ? Math.floor(issues.reduce((s, i) => s + String(i.description ?? "").length, 0) / issues.length) : 0;
    return { file: name, issues: issues.length, avg_desc_chars: avg };
  });
  return {
    per_file_found: per.filter((b) => foundPerFile(result, b)).map((b) => b.id),
    cross_file_found: cross.filter((b) => foundCross(result, b)).map((b) => b.id),
    per_file_total: per.length,
    cross_file_total: cross.length,
    depth,
  };
}

export type Report = ReturnType<typeof compare>;

export function compare(single: ReviewResult, multi: ReviewResult) {
  const key = (JSON.parse(readFileSync(join(SAMPLE_DIR, "ANSWER_KEY.json"), "utf8")) as { bugs: Bug[] }).bugs;
  const files = loadFiles();
  const s = score(single, key, files);
  const m = score(multi, key, files);
  const twins = key.filter((b) => b.type === "async_foreach");
  const consistencyOf = (res: ReviewResult) => {
    const flags = twins.map((b) => foundPerFile(res, b));
    return { flags: Object.fromEntries(twins.map((b, i) => [b.file, flags[i]])), consistent: new Set(flags).size === 1 };
  };
  const report = {
    single: s,
    multi: m,
    identical_code_03_11: { single: consistencyOf(single), multi: consistencyOf(multi) },
    cross_file_only_by_integration: m.cross_file_found.filter((id) => !s.cross_file_found.includes(id)),
  };
  printReport(report);
  return report;
}

function printReport(rep: {
  single: ReturnType<typeof score>; multi: ReturnType<typeof score>;
  identical_code_03_11: Record<string, { flags: Record<string, boolean>; consistent: boolean }>;
  cross_file_only_by_integration: string[];
}) {
  console.log("Độ sâu theo thứ tự file (số issue | độ dài mô tả TB):");
  console.log(`  ${"file".padEnd(28)} ${"single".padStart(14)} ${"multi".padStart(14)}`);
  rep.single.depth.forEach((s, i) => {
    const m = rep.multi.depth[i];
    console.log(
      `  ${s.file.padEnd(28)} ${String(s.issues).padStart(6)} | ${String(s.avg_desc_chars).padStart(5)}  ` +
        `${String(m.issues).padStart(6)} | ${String(m.avg_desc_chars).padStart(5)}`,
    );
  });
  for (const k of ["single", "multi"] as const) {
    const r = rep[k];
    console.log(
      `${k.padEnd(6)}: lỗi trong file ${r.per_file_found.length}/${r.per_file_total} ${JSON.stringify(r.per_file_found)}, ` +
        `lỗi chéo file ${r.cross_file_found.length}/${r.cross_file_total} ${JSON.stringify(r.cross_file_found)}`,
    );
  }
  for (const [k, v] of Object.entries(rep.identical_code_03_11))
    console.log(`Đoạn forEach y hệt ở 03 & 11 – ${k}: ${JSON.stringify(v.flags)} → ${v.consistent ? "nhất quán" : "KHÔNG nhất quán (dilution)"}`);
  console.log(`Lỗi chéo file chỉ integration pass bắt được: ${JSON.stringify(rep.cross_file_only_by_integration)}`);
}

function save(name: string, data: unknown) {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR);
  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

const loadResult = (name: string) => JSON.parse(readFileSync(join(OUT_DIR, `${name}.json`), "utf8")) as ReviewResult;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === "single") save("single", await singlePass(loadFiles(), httpTransport()));
  else if (cmd === "multi") save("multi", await multiPass(loadFiles(), httpTransport()));
  else if (cmd === "compare") save("compare", compare(loadResult("single"), loadResult("multi")));
  else if (cmd === "all") {
    const files = loadFiles();
    const transport = httpTransport();
    const single = await singlePass(files, transport);
    save("single", single);
    const multi = await multiPass(files, transport);
    save("multi", multi);
    save("compare", compare(single, multi));
  } else {
    console.error(`Dùng: node --experimental-strip-types ${basename(fileURLToPath(import.meta.url))} single|multi|compare|all`);
    process.exitCode = 1;
  }
}
