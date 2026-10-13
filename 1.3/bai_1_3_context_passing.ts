// Bài tập 1.3 — Context Passing with Structured Metadata (Claude Agent SDK, TypeScript)
//
// Coordinator spawn SONG SONG 2 subagent nghiên cứu (web-researcher, doc-analyst),
// gom findings có metadata (nguồn, trang, độ tin cậy), rồi chuyển NGUYÊN VẸN cho
// synthesizer. Code kiểm tra: (1) spawn song song thật, (2) findings tới synthesizer
// đủ metadata, (3) mọi claim trong báo cáo cuối đều có trích dẫn hợp lệ.
//
// Chạy: npm i @anthropic-ai/claude-agent-sdk && export ANTHROPIC_API_KEY=...
//       node --experimental-strip-types bai_1_3_context_passing.ts "câu hỏi"
//       Không có API key: ./run_cli.sh "câu hỏi" (dùng phiên đăng nhập claude.ai của Claude Code CLI)
//
// Ghi nhớ khi thi (phân biệt 3 thứ dễ nhầm):
// - Song song: nhiều lời gọi Agent trong CÙNG một response của coordinator → các
//   subagent chạy đồng thời, mỗi con có context RIÊNG, rỗng (chỉ nhận prompt của Agent call).
// - resume (`resume: sessionId` / `--resume`): tiếp tục TUYẾN TÍNH đúng session cũ.
// - fork (`resume` + `forkSession: true` / `fork_session=True`): rẽ nhánh từ một mốc
//   chung sang session ID mới, nhánh cũ giữ nguyên — dùng để thử 2 hướng từ cùng baseline.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDefinition, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// ---------- 1. Định dạng có cấu trúc: content tách khỏi metadata ----------

export interface Finding {
  id: string; // "W1", "D2"… để báo cáo cuối trích dẫn lại
  // content
  claim: string;
  analysis: string;
  // metadata (attribution) — không được rơi rớt khi đi qua coordinator
  source_type: "web" | "document";
  source_url: string | null; // bắt buộc khi source_type = web
  document_name: string | null; // bắt buộc khi source_type = document
  page_number: number | null; // bắt buộc khi source_type = document
  confidence: "high" | "medium" | "low";
}

export const FINDING_SCHEMA = {
  type: "object",
  required: ["id", "claim", "analysis", "source_type", "source_url", "document_name", "page_number", "confidence"],
  properties: {
    id: { type: "string" },
    claim: { type: "string", description: "Một khẳng định, một câu" },
    analysis: { type: "string", description: "Diễn giải / ý nghĩa của khẳng định" },
    source_type: { enum: ["web", "document"] },
    source_url: { type: ["string", "null"] },
    document_name: { type: ["string", "null"] },
    page_number: { type: ["integer", "null"] },
    confidence: { enum: ["high", "medium", "low"] },
  },
} as const;

// Báo cáo cuối: structured output của coordinator (outputFormat json_schema)
export interface Report {
  summary: string;
  claims: { statement: string; finding_ids: string[]; citation: string }[];
}

export const REPORT_SCHEMA = {
  type: "object",
  required: ["summary", "claims"],
  properties: {
    summary: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object",
        required: ["statement", "finding_ids", "citation"],
        properties: {
          statement: { type: "string" },
          finding_ids: { type: "array", items: { type: "string" }, minItems: 1 },
          citation: { type: "string", description: "URL, hoặc 'tên tài liệu, tr. N'" },
        },
      },
    },
  },
} as const;

// ---------- 2. Hai subagent có phạm vi tool hẹp + synthesizer ----------

const FINDINGS_RULE = `Trả về DUY NHẤT một mảng JSON các finding, mỗi phần tử đúng schema:
${JSON.stringify(FINDING_SCHEMA)}
Mỗi finding chỉ một claim. Không bịa nguồn; không tìm được nguồn thì bỏ claim đó.`;

export const AGENTS: Record<string, AgentDefinition> = {
  "web-researcher": {
    description: "Tìm thông tin công khai trên web. Dùng cho phần cần nguồn bên ngoài.",
    prompt: `Bạn là chuyên viên tìm kiếm web. Chỉ dùng WebSearch/WebFetch.
Đặt id dạng W1, W2…; source_type="web", source_url là URL thật đã đọc, document_name=null, page_number=null.
${FINDINGS_RULE}`,
    tools: ["WebSearch", "WebFetch"], // chỉ tool tìm kiếm
  },
  "doc-analyst": {
    description: "Phân tích tài liệu nội bộ trong thư mục bai_1_3_docs. Dùng cho phần dữ liệu nội bộ.",
    prompt: `Bạn là chuyên viên phân tích tài liệu. Chỉ dùng Read/Grep/Glob, chỉ đọc thư mục bai_1_3_docs.
Số trang lấy từ dấu "--- Trang N ---" đứng TRƯỚC đoạn chứa thông tin.
Đặt id dạng D1, D2…; source_type="document", document_name là tên file, page_number là số trang, source_url=null.
${FINDINGS_RULE}`,
    tools: ["Read", "Grep", "Glob"], // chỉ tool đọc file
  },
  synthesizer: {
    description: "Tổng hợp các finding đã có thành báo cáo có trích dẫn. Không tự nghiên cứu thêm.",
    prompt: `Bạn tổng hợp báo cáo từ mảng findings trong thẻ <findings>.
Mỗi câu khẳng định trong báo cáo phải ghi finding_ids và citation lấy từ metadata của finding đó
(web: source_url; document: "document_name, tr. page_number"). Không thêm khẳng định nào không có finding.`,
    tools: [], // không cần tool: mọi dữ liệu đã nằm trong prompt
  },
};

// Context của subagent KHÔNG kế thừa từ coordinator → coordinator phải tự nhét
// câu hỏi, phạm vi và findings vào prompt của từng lời gọi Agent.
export function coordinatorPrompt(question: string): string {
  return `Câu hỏi nghiên cứu: ${question}

Quy trình bắt buộc:
1. Trong CÙNG MỘT response, gọi Agent hai lần song song: subagent_type "web-researcher" và
   subagent_type "doc-analyst". Prompt của mỗi lời gọi phải chứa nguyên văn câu hỏi ở trên
   (subagent không thấy hội thoại này). Đợi cả hai hoàn thành.
2. Gộp hai mảng findings, GIỮ NGUYÊN mọi trường (không tóm tắt, không bỏ metadata).
3. Gọi Agent với subagent_type "synthesizer"; prompt chứa câu hỏi và toàn bộ findings dạng JSON
   đặt giữa <findings> và </findings>.
4. Trả về báo cáo của synthesizer theo đúng output schema.`;
}

// ---------- 3. Kiểm tra ở tầng code (không tin vào prompt) ----------

type ToolUse = { id: string; name: string; input: Record<string, unknown> };
const isAgentTool = (name: string) => name === "Agent" || name === "Task"; // tên cũ là Task

// SDK stream mỗi content block thành một SDKAssistantMessage riêng nhưng cùng message.id,
// nên phải gom theo message.id mới biết các Agent call có nằm trong cùng một response không.
export function agentCallsByResponse(messages: SDKMessage[]): Map<string, ToolUse[]> {
  const byId = new Map<string, ToolUse[]>();
  for (const m of messages) {
    if (m.type !== "assistant" || m.parent_tool_use_id !== null) continue; // chỉ coordinator
    for (const b of m.message.content) {
      if (b.type !== "tool_use" || !isAgentTool(b.name)) continue;
      const list = byId.get(m.message.id) ?? [];
      list.push({ id: b.id, name: b.name, input: b.input as Record<string, unknown> });
      byId.set(m.message.id, list);
    }
  }
  return byId;
}

export function researchSpawnedInParallel(messages: SDKMessage[]): boolean {
  for (const calls of agentCallsByResponse(messages).values()) {
    const types = new Set(calls.map((c) => c.input.subagent_type));
    if (types.has("web-researcher") && types.has("doc-analyst")) return true;
  }
  return false;
}

export function findingErrors(f: Finding): string[] {
  const errs: string[] = [];
  if (!f.id || !f.claim || !f.analysis) errs.push(`${f.id ?? "?"}: thiếu id/claim/analysis`);
  if (!["high", "medium", "low"].includes(f.confidence)) errs.push(`${f.id}: confidence không hợp lệ`);
  if (f.source_type === "web" && !/^https?:\/\//.test(f.source_url ?? ""))
    errs.push(`${f.id}: finding web thiếu source_url`);
  if (f.source_type === "document" && (!f.document_name || !Number.isInteger(f.page_number)))
    errs.push(`${f.id}: finding tài liệu thiếu document_name/page_number`);
  if (f.source_type !== "web" && f.source_type !== "document") errs.push(`${f.id}: source_type lạ`);
  return errs;
}

// Lấy findings mà coordinator THỰC SỰ gửi cho synthesizer (đọc từ input của Agent call)
export function findingsSentToSynthesizer(messages: SDKMessage[]): Finding[] | null {
  for (const calls of agentCallsByResponse(messages).values()) {
    for (const c of calls) {
      if (c.input.subagent_type !== "synthesizer") continue;
      const m = String(c.input.prompt ?? "").match(/<findings>([\s\S]*?)<\/findings>/);
      if (!m) return null;
      return JSON.parse(m[1]) as Finding[];
    }
  }
  return null;
}

// Không có claim mồ côi: mỗi claim phải trỏ tới finding có thật và citation khớp metadata
export function orphanClaims(report: Report, findings: Finding[]): string[] {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const problems: string[] = [];
  for (const c of report.claims) {
    if (c.finding_ids.length === 0) {
      problems.push(`Không có nguồn: "${c.statement}"`);
      continue;
    }
    for (const id of c.finding_ids) {
      const f = byId.get(id);
      if (!f) {
        problems.push(`Trỏ tới finding không tồn tại ${id}: "${c.statement}"`);
        continue;
      }
      const ok = f.source_type === "web"
        ? c.citation.includes(f.source_url ?? "\u0000")
        : c.citation.includes(f.document_name ?? "\u0000") &&
          new RegExp(`(tr\\.|trang|p\\.|page)\\s*${f.page_number}(?!\\d)`, "i").test(c.citation);
      if (!ok) problems.push(`Citation không khớp metadata của ${id}: "${c.citation}"`);
    }
  }
  return problems;
}

// ---------- 4. Chạy coordinator ----------

export async function research(question: string) {
  const messages: SDKMessage[] = [];
  let report: Report | null = null;

  for await (const m of query({
    prompt: coordinatorPrompt(question),
    options: {
      // "Agent" là cổng cứng: thiếu nó thì coordinator KHÔNG thể spawn subagent.
      // Liệt kê luôn tool của subagent để chúng chạy không cần hỏi quyền.
      allowedTools: ["Agent", "WebSearch", "WebFetch", "Read", "Grep", "Glob"],
      agents: AGENTS,
      outputFormat: { type: "json_schema", schema: REPORT_SCHEMA },
      maxTurns: 20,
      maxBudgetUsd: 2,
      cwd: new URL(".", import.meta.url).pathname,
      // Không có API key: trỏ SDK về CLI đã đăng nhập claude.ai (vd CLAUDE_BIN=$(which claude)).
      // Bỏ trống thì SDK dùng binary đóng gói sẵn trong @anthropic-ai/claude-agent-sdk-<platform>.
      ...(process.env.CLAUDE_BIN ? { pathToClaudeCodeExecutable: process.env.CLAUDE_BIN } : {}),
    },
  })) {
    messages.push(m);
    if (m.type === "result") {
      if (m.subtype !== "success") throw new Error(`Coordinator dừng bất thường: ${m.subtype}`);
      report = m.structured_output as Report;
    }
  }
  if (!report) throw new Error("Không nhận được báo cáo có cấu trúc");
  return { messages, report };
}

export function verify(messages: SDKMessage[], report: Report) {
  const sent = findingsSentToSynthesizer(messages);
  return {
    parallel: researchSpawnedInParallel(messages),
    findingsSent: sent?.length ?? 0,
    metadataErrors: sent ? sent.flatMap(findingErrors) : ["Synthesizer không nhận được <findings>"],
    orphanClaims: sent ? orphanClaims(report, sent) : [],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const question = process.argv[2] ??
    "Làm việc hybrid ảnh hưởng thế nào tới năng suất kỹ sư phần mềm, và công ty mình đang áp dụng ra sao?";
  const { messages, report } = await research(question);
  console.log(JSON.stringify(report, null, 2));
  const v = verify(messages, report);
  console.log("\n== Kiểm tra ==");
  console.log(`Spawn song song 2 subagent nghiên cứu: ${v.parallel ? "CÓ" : "KHÔNG"}`);
  console.log(`Findings gửi tới synthesizer: ${v.findingsSent}`);
  console.log(`Lỗi metadata: ${v.metadataErrors.length ? v.metadataErrors.join("; ") : "không"}`);
  console.log(`Claim mồ côi: ${v.orphanClaims.length ? v.orphanClaims.join("; ") : "không"}`);
  if (!v.parallel || v.metadataErrors.length || v.orphanClaims.length) process.exitCode = 1;
}
