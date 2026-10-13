// Bài 2.3 – Build Exercise: chạy end-to-end hệ coordinator + 3 subagent với tool phân theo vai trò.
//
// Dùng Claude Messages API trực tiếp (fetch, không cần SDK) vì tool_choice là tham số của
// Messages API và cần đổi theo TỪNG LƯỢT (doc_analysis: lượt 1 ép extract_metadata, sau đó auto).
// Agent SDK / Claude Code không cho đặt tool_choice từng lượt như vậy.
//
// Mỗi agent là một vòng lặp agent riêng (bài 1.1): stop_reason "tool_use" → chạy tool → lặp;
// "end_turn" → xong. Riêng synthesis dùng tool_choice "any" nên không bao giờ end_turn: phiên kết thúc
// khi gọi terminal tool compile_report.
//
// Lớp audit: MỌI tool_use đều được đối chiếu với allowlist của agent đang chạy. Tool ngoài bộ
// → ghi vi phạm, trả tool_result is_error, KHÔNG thực thi.
//
// Chạy:  node --experimental-strip-types multi_agent_run.ts                 # client GIẢ LẬP (stub), mặc định
//        node --experimental-strip-types multi_agent_run.ts --misuse-demo   # stub: synthesis cố gọi search_web → audit chặn
//        ANTHROPIC_API_KEY=... node --experimental-strip-types multi_agent_run.ts --real   # Claude thật (CHƯA chạy)
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  httpTransport,
  type ContentBlock,
  type Message,
  type MessagesRequest,
  type MessagesResponse,
  type ToolChoice,
  type UserBlock,
} from "../lib/anthropic.ts";
import { AGENTS, allowedNames, type Role } from "./tool_config.ts";
import { validate as validateDocument } from "./load_document.ts";

export const MODEL = process.env.MODEL ?? "claude-haiku-5-5";
const MAX_TURNS = 10; // lưới an toàn, không phải điều kiện dừng chính
export const QUESTION = "Làm việc hybrid ảnh hưởng thế nào tới năng suất nhân viên văn phòng ở Việt Nam năm 2026? " +
  "Cần số liệu có nguồn.";

export const SYSTEM_PROMPTS: Record<Role, string> = {
  coordinator: "Bạn là coordinator của hệ nghiên cứu. Chia việc cho subagent bằng tool Agent " +
    "(web_search tìm nguồn → doc_analysis phân tích → synthesis viết báo cáo). " +
    "Truyền đủ context trong prompt giao việc. Nhận định synthesis đưa vào " +
    "needs_coordinator_verification là kiểm chứng phức tạp: giao doc_analysis dùng verify_claim. " +
    "Duyệt bằng review_output rồi trả lời người dùng.",
  web_search: "Bạn là agent tìm nguồn. Chỉ dùng tool của mình. Lưu mọi trích đoạn bằng save_snippet. " +
    "Kết thúc bằng tóm tắt các nguồn kèm document_id và url.",
  doc_analysis: "Bạn là agent phân tích tài liệu. Luôn lấy metadata trước, rồi số liệu, tóm tắt. " +
    "Kết thúc bằng các phát hiện kèm nguồn.",
  synthesis: "Bạn là agent tổng hợp. Tra dữ kiện đơn giản một nguồn bằng verify_fact; nhận định phức tạp " +
    "đưa vào needs_coordinator_verification. Kết thúc bằng compile_report.",
};

type Json = Record<string, any>;
/** [dữ liệu trả về, isError] */
export type ToolOutcome = [Json, boolean];

// ---------------------------------------------------------------------------
// Thế giới giả lập: kết quả tìm kiếm, tài liệu, kho trích đoạn (tool chạy local, dữ liệu mock)
// ---------------------------------------------------------------------------
interface Doc {
  id: string; title: string; author: string; date: string; type: string;
  data: { value: string; what: string; location: string }[];
  summary: string[];
}

export class MockWorld {
  static readonly DOCS: Record<string, Doc> = {
    "https://www.gso.gov.vn/bao-cao-lao-dong-2026.pdf": {
      id: "doc-gso", title: "Báo cáo điều tra lao động việc làm 2026", author: "Tổng cục Thống kê (GSO)",
      date: "2026-07-15", type: "báo cáo thống kê",
      data: [{ value: "62%", what: "doanh nghiệp văn phòng áp dụng hybrid", location: "tr. 14" },
        { value: "2,4 ngày/tuần", what: "số ngày làm tại nhà trung bình", location: "tr. 15" }],
      summary: ["Hybrid phổ biến ở doanh nghiệp văn phòng", "Nhóm 25–35 tuổi chọn hybrid nhiều nhất",
        "Báo cáo không đo trực tiếp năng suất"],
    },
    "https://www.ilo.org/hybrid-work-asia-2025.pdf": {
      id: "doc-ilo", title: "Hybrid Work in Asia-Pacific 2025", author: "ILO", date: "2025-11-02",
      type: "báo cáo nghiên cứu",
      data: [{ value: "4–7%", what: "năng suất tự đánh giá tăng với hybrid 2–3 ngày", location: "p. 31" },
        { value: "n = 3.200", what: "mẫu khảo sát 6 nước, có Việt Nam", location: "p. 8" }],
      summary: ["Hybrid 2–3 ngày/tuần gắn với năng suất tự đánh giá cao hơn", "Toàn thời gian tại nhà không tốt hơn",
        "Số liệu tự đánh giá, không phải đo lường khách quan"],
    },
  };

  // Heuristic giả lập của verify_fact: nhận định có từ so sánh/nhân quả → coi là phức tạp.
  static readonly COMPLEX_MARKERS = ["so với", "dẫn đến", "làm tăng", "làm giảm", "do ", "nhờ", "vì "];

  snippets: { url: string; quote: string; location: string }[] = [];
  private loaded = new Set<string>();

  docById(id: unknown): Doc | undefined {
    return Object.values(MockWorld.DOCS).find((d) => d.id === id);
  }

  execute(name: string, input: Json): ToolOutcome {
    const ok = (data: Json): ToolOutcome => [data, false];
    const doc = () => this.docById(input.document_id);
    switch (name) {
      case "search_web":
        return ok({
          results: [
            ...Object.entries(MockWorld.DOCS).map(([url, d]) => ({ title: d.title, url, snippet: d.summary[0] })),
            { title: "Biểu đồ hybrid 2026", url: "https://www.gso.gov.vn/images/hybrid-chart.png", snippet: "ảnh" },
          ],
        });
      case "load_document": {
        const e = validateDocument(input.url);
        if (e) return [e.structuredContent, true];
        const d = MockWorld.DOCS[String(input.url)];
        if (!d) return [{ errorCategory: "validation", isRetryable: false, description: "Không có tài liệu tại URL này." }, true];
        this.loaded.add(d.id);
        return ok({ document_id: d.id, title: d.title, chars: 18_000 });
      }
      case "extract_links":
        return ok({ links: [] });
      case "save_snippet":
        this.snippets.push({ url: input.url, quote: input.quote, location: input.location });
        return ok({ saved: true, total: this.snippets.length });
      case "extract_metadata": {
        const d = doc();
        return d ? ok({ title: d.title, author: d.author, date: d.date, type: d.type }) : this.missingDoc(input);
      }
      case "extract_data_points": {
        const d = doc();
        return d ? ok({ data_points: d.data }) : this.missingDoc(input);
      }
      case "summarize_content": {
        const d = doc();
        return d ? ok({ summary: d.summary }) : this.missingDoc(input);
      }
      case "verify_claim":
        return ok({
          claim: input.claim, verdict: "một phần đúng", confidence: "trung bình",
          reasoning: "ILO đo năng suất TỰ ĐÁNH GIÁ, mẫu 6 nước; GSO không đo năng suất. " +
            "Không đủ cơ sở khẳng định con số 4–7% cho riêng Việt Nam.",
          sources: input.document_ids,
        });
      case "verify_fact":
        return this.verifyFact(input);
      case "format_citation":
        return ok({ citation: `${input.author} (${input.year}). ${input.title}. ${input.url}` });
      case "assess_coverage":
        return ok({ missing: [], covered: input.draft_outline });
      case "compile_report":
        return ok({ accepted: true });
      case "review_output":
      case "request_revision":
        return ok({ recorded: true });
      default:
        return [{ errorCategory: "validation", isRetryable: false, description: `Tool không tồn tại: ${name}` }, true];
    }
  }

  // verify_fact là tool SCOPED: chỉ tra một dữ kiện đơn trong MỘT nguồn đã lưu.
  verifyFact(input: Json): ToolOutcome {
    const fact = String(input.fact ?? "");
    if (MockWorld.COMPLEX_MARKERS.some((m) => fact.toLowerCase().includes(m))) {
      return [{
        errorCategory: "business", isRetryable: false,
        description: "Ngoài phạm vi verify_fact (nhận định so sánh/nhân quả cần nhiều nguồn). " +
          "Đưa vào needs_coordinator_verification.",
      }, true];
    }
    const hit = this.snippets.find((s) =>
      s.url === input.source_url && fact.split(/\s+/).some((w) => /\d/.test(w) && s.quote.includes(w)));
    return hit
      ? [{ verified: true, source_url: hit.url, quote: hit.quote, location: hit.location }, false]
      : [{ verified: false, note: "Không thấy dữ kiện trong trích đoạn đã lưu của nguồn này." }, false];
  }

  missingDoc(input: Json): ToolOutcome {
    return [{ errorCategory: "validation", isRetryable: false, description: `document_id '${input.document_id}' chưa được tải.` }, true];
  }
}

// ---------------------------------------------------------------------------
// Payload: tool_choice theo lượt + ràng buộc API
// ---------------------------------------------------------------------------
export function buildPayload(
  agent: Role, turn: number, messages: Message[],
  { thinking }: { thinking?: MessagesRequest["thinking"] } = {},
): MessagesRequest & { tool_choice: ToolChoice } {
  const cfg = AGENTS[agent];
  const choice = cfg.tool_choice(turn);
  // Ràng buộc của Messages API: khi bật extended thinking, tool_choice chỉ được auto hoặc none.
  if (thinking && (choice.type === "any" || choice.type === "tool")) {
    throw new RangeError(`tool_choice ${choice.type} không dùng được cùng extended thinking (chỉ auto/none)`);
  }
  const payload: MessagesRequest & { tool_choice: ToolChoice } = {
    model: MODEL, max_tokens: 2048, system: SYSTEM_PROMPTS[agent],
    tools: cfg.tools, tool_choice: choice, messages,
  };
  if (thinking) payload.thinking = thinking;
  return payload;
}

// ---------------------------------------------------------------------------
// Client: thật (CHƯA chạy) và giả lập
// ---------------------------------------------------------------------------
export interface Client {
  create(payload: MessagesRequest & { tool_choice: ToolChoice }, ctx: { agent: Role; session: string }): Promise<MessagesResponse>;
}

/** Transport thật qua lib/anthropic.ts (cần ANTHROPIC_API_KEY). */
export class RealClient implements Client {
  private send = httpTransport();
  create(payload: MessagesRequest) {
    return this.send(payload);
  }
}

type Call = [string, Json];
type Step = Call[] | string;

// GIẢ LẬP: đóng vai Claude theo kịch bản cố định. Tôn trọng tool_choice như API thật:
// forced → trả đúng tool đó; any → luôn trả tool_use; auto → có thể trả text.
// Kết quả phản ánh KỊCH BẢN, không phải hành vi của Claude.
export class StubClient implements Client {
  static readonly GSO = "https://www.gso.gov.vn/bao-cao-lao-dong-2026.pdf";
  static readonly ILO = "https://www.ilo.org/hybrid-work-asia-2025.pdf";
  static readonly COMPLEX = "Hybrid làm tăng năng suất 4–7% so với làm toàn thời gian tại văn phòng ở Việt Nam";

  private misuse: boolean;
  private seq = 0;

  constructor({ misuseDemo = false }: { misuseDemo?: boolean } = {}) {
    this.misuse = misuseDemo;
  }

  async create(payload: MessagesRequest & { tool_choice: ToolChoice }, { agent, session }: { agent: Role; session: string }) {
    const turn = payload.messages.filter((m) => m.role === "assistant").length + 1;
    const calls = this.script(agent, session, turn, payload);
    if (calls === undefined) throw new Error(`stub hết kịch bản: ${agent} lượt ${turn}`);
    const choice = payload.tool_choice;
    if (choice.type === "tool" && (typeof calls === "string" || calls.map((c) => c[0]).join() !== choice.name)) {
      throw new Error(`stub sai kịch bản: lượt ${turn} của ${agent} bị ép ${choice.name}`);
    }
    if (choice.type === "any" && typeof calls === "string") throw new Error(`stub sai kịch bản: ${agent} bị ép any nhưng trả text`);

    const res: MessagesResponse = typeof calls === "string"
      ? { id: `msg_stub_${this.seq}`, role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: calls }] }
      : {
        id: `msg_stub_${this.seq}`, role: "assistant", stop_reason: "tool_use",
        content: calls.map(([name, input]) => ({ type: "tool_use", id: `toolu_${++this.seq}`, name, input })),
      };
    return res;
  }

  private lastResults(payload: MessagesRequest): string {
    const m = [...payload.messages].reverse().find((x) => x.role === "user" && Array.isArray(x.content));
    return m && Array.isArray(m.content) ? m.content.map((b) => ("content" in b ? b.content : "")).join("\n") : "";
  }

  private script(agent: Role, session: string, turn: number, payload: MessagesRequest): Step | undefined {
    const { GSO, ILO, COMPLEX } = StubClient;
    switch (agent) {
      case "coordinator":
        return this.coordinator(turn, payload);
      case "web_search":
        return [
          [["search_web", { query: "năng suất làm việc hybrid Việt Nam 2026" }]],
          [["load_document", { url: GSO }], ["load_document", { url: ILO }],
            ["load_document", { url: "https://www.gso.gov.vn/images/hybrid-chart.png" }]],
          [["save_snippet", { url: GSO, quote: "62% doanh nghiệp văn phòng áp dụng hybrid", location: "tr. 14" }],
            ["save_snippet", { url: ILO, quote: "năng suất tự đánh giá tăng 4–7% với hybrid 2–3 ngày", location: "p. 31" }]],
          `Nguồn: doc-gso (${GSO}), doc-ilo (${ILO}). Bỏ ảnh hybrid-chart.png vì load_document từ chối (không phải tài liệu).`,
        ][turn - 1] as Step | undefined;
      case "doc_analysis":
        if (session.includes("verify")) {
          return [
            [["extract_metadata", { document_id: "doc-ilo" }]],
            [["verify_claim", { claim: COMPLEX, document_ids: ["doc-gso", "doc-ilo"] }]],
            "Kiểm chứng: một phần đúng. Con số 4–7% là năng suất tự đánh giá, mẫu 6 nước; không dùng như số đo của riêng Việt Nam.",
          ][turn - 1] as Step | undefined;
        }
        return [
          [["extract_metadata", { document_id: "doc-gso" }]],
          [["extract_metadata", { document_id: "doc-ilo" }],
            ["extract_data_points", { document_id: "doc-gso", topic: "hybrid" }],
            ["extract_data_points", { document_id: "doc-ilo", topic: "năng suất" }]],
          [["summarize_content", { document_id: "doc-gso" }], ["summarize_content", { document_id: "doc-ilo" }]],
          "Phát hiện: GSO 62% doanh nghiệp áp dụng hybrid (tr. 14); ILO năng suất tự đánh giá +4–7% (p. 31).",
        ][turn - 1] as Step | undefined;
      case "synthesis": {
        const steps: Call[][] = [
          [["verify_fact", { fact: "62% doanh nghiệp văn phòng áp dụng hybrid", source_url: GSO }],
            ["verify_fact", { fact: COMPLEX, source_url: ILO }]],
          [["format_citation", { author: "Tổng cục Thống kê", year: "2026", title: "Báo cáo điều tra lao động việc làm 2026", url: GSO }],
            ["format_citation", { author: "ILO", year: "2025", title: "Hybrid Work in Asia-Pacific 2025", url: ILO }]],
          [["assess_coverage", { question: QUESTION, draft_outline: ["Mức độ phổ biến", "Tác động năng suất", "Giới hạn số liệu"] }]],
          [["compile_report", {
            title: "Làm việc hybrid và năng suất văn phòng tại Việt Nam (2026)",
            sections: [
              { heading: "Mức độ phổ biến", body: "62% doanh nghiệp văn phòng áp dụng hybrid.", citations: [GSO] },
              { heading: "Tác động năng suất", body: "Khảo sát khu vực cho thấy năng suất tự đánh giá cao hơn với hybrid 2–3 ngày.", citations: [ILO] },
            ],
            needs_coordinator_verification: [COMPLEX],
          }]],
        ];
        if (this.misuse) steps.unshift([["search_web", { query: "năng suất hybrid" }]]);
        return steps[turn - 1];
      }
    }
  }

  private coordinator(turn: number, payload: MessagesRequest): Step | undefined {
    const prev = this.lastResults(payload);
    return [
      [["Agent", { agent_type: "web_search", prompt: `Tìm 2–3 nguồn tài liệu đáng tin về: ${QUESTION}` }]],
      [["Agent", { agent_type: "doc_analysis", prompt: `Phân tích các tài liệu sau, trích số liệu kèm vị trí.\n${prev}` }]],
      [["Agent", { agent_type: "synthesis", prompt: `Viết báo cáo trả lời: ${QUESTION}\nPhát hiện:\n${prev}` }]],
      [["Agent", { agent_type: "doc_analysis", prompt: `Kiểm chứng đầy đủ nhận định: ${StubClient.COMPLEX}. Tài liệu: doc-gso, doc-ilo.` }]],
      [["review_output", { agent_type: "synthesis", verdict: "pass", reason: "Đủ nguồn; nhận định phức tạp đã kiểm chứng và ghi giới hạn." }]],
      "Báo cáo hoàn tất: 62% doanh nghiệp áp dụng hybrid (GSO 2026). Con số năng suất +4–7% là tự đánh giá, mẫu khu vực (ILO 2025), không phải số đo riêng của Việt Nam.",
    ][turn - 1] as Step | undefined;
  }
}

// ---------------------------------------------------------------------------
// Runner: vòng lặp agent + audit allowlist + log JSONL
// ---------------------------------------------------------------------------
export interface CallEntry {
  type?: undefined;
  agent: Role; session: string; turn: number; tool_choice: ToolChoice;
  tools_offered: string[]; stop_reason: string; tool_calls: string[];
}
export interface ToolErrorEntry { type: "tool_error"; agent: Role; session: string; tool: string; error: Json }
export interface ViolationEntry { type: "violation"; agent: Role; session: string; tool: string }
export type LogEntry = CallEntry | ToolErrorEntry | ViolationEntry;

type ToolUse = Extract<ContentBlock, { type: "tool_use" }>;

export class Runner {
  log: LogEntry[] = [];
  violations: { agent: Role; session: string; tool: string }[] = [];
  world = new MockWorld();
  private client: Client;
  private logPath?: string;
  private sessions = new Map<Role, number>();

  constructor(client: Client, { logPath }: { logPath?: string } = {}) {
    this.client = client;
    this.logPath = logPath;
  }

  record(entry: LogEntry): void {
    this.log.push(entry);
    if (this.logPath) appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
  }

  /** Trả [kết quả text hoặc input của terminal tool, session_id] */
  async runAgent(agent: Role, prompt: string, { sessionTag }: { sessionTag?: string } = {}): Promise<[string | Json, string]> {
    const n = (this.sessions.get(agent) ?? 0) + 1;
    this.sessions.set(agent, n);
    const session = `${agent}#${n}${sessionTag ? `-${sessionTag}` : ""}`;
    const cfg = AGENTS[agent];
    const allowed = allowedNames(agent);
    const messages: Message[] = [{ role: "user", content: prompt }];

    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      const payload = buildPayload(agent, turn, messages);
      const resp = await this.client.create(payload, { agent, session });
      const uses = resp.content.filter((b): b is ToolUse => b.type === "tool_use");
      this.record({
        agent, session, turn, tool_choice: payload.tool_choice,
        tools_offered: allowed, stop_reason: resp.stop_reason, tool_calls: uses.map((u) => u.name),
      });
      messages.push({ role: "assistant", content: resp.content });

      if (resp.stop_reason !== "tool_use") {
        return [resp.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""), session];
      }

      let terminalInput: Json | null = null;
      const results: UserBlock[] = [];
      for (const u of uses) {
        const [content, isErr] = await this.dispatch(agent, session, allowed, u);
        if (isErr && allowed.includes(u.name)) {
          this.record({ type: "tool_error", agent, session, tool: u.name, error: content });
        }
        if (u.name === cfg.terminal_tool && !isErr) terminalInput = u.input;
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(content), is_error: isErr });
      }
      messages.push({ role: "user", content: results });
      if (terminalInput) return [terminalInput, session];
    }
    throw new Error(`${session} vượt ${MAX_TURNS} lượt`);
  }

  async dispatch(agent: Role, session: string, allowed: string[], use: Pick<ToolUse, "name" | "input">): Promise<ToolOutcome> {
    const { name } = use;
    if (!allowed.includes(name)) {
      this.violations.push({ agent, session, tool: name });
      this.record({ type: "violation", agent, session, tool: name });
      return [{
        errorCategory: "permission", isRetryable: false,
        description: `Tool '${name}' không thuộc bộ tool của ${agent}. Dùng tool của bạn hoặc trả việc về coordinator.`,
      }, true];
    }
    if (name === "Agent") {
      const sub = use.input.agent_type as Role;
      const prompt = String(use.input.prompt);
      const tag = prompt.startsWith("Kiểm chứng") ? "verify" : undefined;
      const [out] = await this.runAgent(sub, prompt, { sessionTag: tag });
      return [typeof out === "string" ? { result: out } : { report: out }, false];
    }
    return this.world.execute(name, use.input);
  }

  async run(question = QUESTION): Promise<string> {
    const [final] = await this.runAgent("coordinator", question);
    return String(final);
  }
}

// ---------------------------------------------------------------------------
// Báo cáo kiểm tra từ log
// ---------------------------------------------------------------------------
export interface LogCheck { name: string; ok: boolean; detail: string }

const tally = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

export function verifyLog(runner: Runner): [LogCheck[], Record<string, string[]>] {
  const calls = runner.log.filter((e): e is CallEntry => !e.type);
  const checks: LogCheck[] = [];
  const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

  const used: Record<string, string[]> = {};
  for (const e of calls) (used[e.agent] ??= []).push(...e.tool_calls);
  const outside = Object.entries(used).flatMap(([a, names]) =>
    [...new Set(names)].filter((n) => !allowedNames(a).includes(n)).map((n) => `${a}→${n}`));
  add("mỗi agent chỉ dùng tool trong bộ của mình", outside.length === 0, outside.length === 0 ? "OK" : outside.join(", "));

  const docSessions = new Map<string, CallEntry[]>();
  for (const e of calls.filter((e) => e.agent === "doc_analysis")) docSessions.set(e.session, [...(docSessions.get(e.session) ?? []), e]);
  const firstOk = [...docSessions.values()].every((es) => {
    const f = es.reduce((a, b) => (b.turn < a.turn ? b : a));
    return f.tool_choice.type === "tool" && f.tool_choice.name === "extract_metadata" &&
      f.tool_calls.join() === "extract_metadata" &&
      es.filter((e) => e.turn !== 1).every((e) => e.tool_choice.type === "auto");
  });
  add(`doc_analysis: lượt 1 forced extract_metadata, các lượt sau auto (${docSessions.size} phiên)`, firstOk);

  const syn = used.synthesis ?? [];
  add("synthesis dùng compile_report + verify_fact", syn.includes("compile_report") && syn.includes("verify_fact"),
    Object.entries(tally(syn)).map(([k, v]) => `${k}×${v}`).join(", "));
  add("synthesis luôn chạy với tool_choice any",
    calls.filter((e) => e.agent === "synthesis").every((e) => e.tool_choice.type === "any"));

  const routed = [...docSessions.keys()].some((s) => s.endsWith("-verify")) && (used.doc_analysis ?? []).includes("verify_claim");
  add("nhận định phức tạp được chuyển coordinator → doc_analysis verify_claim", routed);
  add("không có vi phạm audit", runner.violations.length === 0, `${runner.violations.length} vi phạm`);
  return [checks, used];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const real = argv.includes("--real");
  const misuse = argv.includes("--misuse-demo");
  const client: Client = real ? new RealClient() : new StubClient({ misuseDemo: misuse });
  const logDir = join(import.meta.dirname, "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${real ? "real" : "stub"}${misuse ? "-misuse" : ""}.jsonl`);
  rmSync(logPath, { force: true });

  console.log(real ? `== Chạy với Claude thật (${MODEL}) ==` : "== Chạy với client GIẢ LẬP (kịch bản cố định, không phải Claude) ==");
  const runner = new Runner(client, { logPath });
  const final = await runner.run();
  console.log("\n-- Log từng lượt --");
  for (const e of runner.log) {
    if (e.type === "tool_error") {
      console.log(`     ↳ ${e.tool} trả lỗi ${e.error.errorCategory}: ${e.error.description}`);
    } else if (e.type === "violation") {
      console.log(`  !! VI PHẠM  ${e.session} gọi ${e.tool} (không thuộc bộ) → trả is_error, không thực thi`);
    } else {
      const tc = e.tool_choice.type === "tool" ? `tool:${e.tool_choice.name}` : e.tool_choice.type;
      console.log(`  ${e.session.padEnd(22)} lượt ${e.turn}  tool_choice=${tc.padEnd(22)} ${e.tool_calls.length ? e.tool_calls.join(", ") : "(end_turn)"}`);
    }
  }
  const [checks, used] = verifyLog(runner);
  console.log("\n-- Tool đã dùng theo agent --");
  for (const [a, names] of Object.entries(used)) {
    console.log(`  ${a.padEnd(13)} ${Object.entries(tally(names)).map(([k, v]) => (v > 1 ? `${k}×${v}` : k)).join(", ")}`);
  }
  console.log("\n-- Kiểm tra --");
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  [${c.detail}]` : ""}`);
  console.log(`\nTrả lời cuối: ${final}`);
  console.log(`Log: ${logPath.replace(homedir(), "~")}`);
}
