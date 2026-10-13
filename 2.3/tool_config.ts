// Bài 2.3 – Build Exercise: phân bổ tool theo vai trò + tool_choice.
//
// File này là "cấu hình" của hệ đa agent: mỗi agent có bộ tool riêng (4–5 tool),
// chính sách tool_choice theo từng lượt, và danh sách tool cross-role có giới hạn (scoped).
// config_check.ts kiểm tra cấu hình này; multi_agent_run.ts dùng nó để chạy.
import type { Tool, ToolChoice } from "../lib/anthropic.ts";

export function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): Tool {
  return { name, description, input_schema: { type: "object", properties, required } };
}

const STR = { type: "string" } as const;
const str = (description: string) => ({ ...STR, description });

// ---------- Web Search agent: tìm và lấy tài liệu từ web ----------
export const WEB_SEARCH_TOOLS: Tool[] = [
  tool("search_web",
    "Tìm kiếm web theo từ khoá. Trả về tối đa 5 kết quả {title, url, snippet}. " +
    "Dùng để tìm NGUỒN mới. Không dùng để đọc nội dung chi tiết của một trang (dùng load_document).",
    { query: str("Từ khoá tìm kiếm, 3–12 từ") }, ["query"]),
  tool("load_document",
    "Tải nội dung MỘT tài liệu (pdf, docx, md, txt, html) qua https từ domain đã duyệt. " +
    "Thay thế cho fetch_url: từ chối ảnh, API JSON, http, localhost/IP nội bộ với lỗi validation/permission " +
    "(isRetryable=false). Không dùng để gọi API hay tải file bất kỳ.",
    { url: str("URL https trỏ tới tài liệu, vd https://www.gso.gov.vn/bao-cao.pdf") }, ["url"]),
  tool("extract_links",
    "Lấy danh sách liên kết tài liệu (pdf/docx/html) trong một tài liệu ĐÃ tải bằng load_document. " +
    "Không tự tải trang mới.",
    { document_id: str("document_id do load_document trả về") }, ["document_id"]),
  tool("save_snippet",
    "Lưu một đoạn trích kèm metadata nguồn (url, tiêu đề, vị trí) để chuyển cho các agent sau. " +
    "Mọi trích dẫn đưa ra ngoài phải được lưu qua tool này.",
    { url: STR, quote: STR, location: str("trang/đoạn, vd 'tr. 12'") }, ["url", "quote", "location"]),
];

// ---------- Document Analysis agent: phân tích tài liệu đã có ----------
export const DOC_ANALYSIS_TOOLS: Tool[] = [
  tool("extract_metadata",
    "BƯỚC BẮT BUỘC ĐẦU TIÊN cho mỗi tài liệu: lấy tiêu đề, tác giả/tổ chức, ngày xuất bản, loại tài liệu. " +
    "Các bước sau (trích số liệu, tóm tắt, kiểm chứng) dựa trên metadata này để ghi nguồn.",
    { document_id: STR }, ["document_id"]),
  tool("extract_data_points",
    "Trích các số liệu định lượng (con số, tỉ lệ, năm, mẫu khảo sát) từ một tài liệu, kèm vị trí trong tài liệu.",
    { document_id: STR, topic: str("Chủ đề cần trích số liệu") }, ["document_id", "topic"]),
  tool("summarize_content",
    "Tóm tắt nội dung một tài liệu trong 3–5 ý, giữ nguyên quan điểm của tác giả, không thêm nhận định.",
    { document_id: STR }, ["document_id"]),
  tool("verify_claim",
    "Kiểm chứng ĐẦY ĐỦ một nhận định: đối chiếu nhiều tài liệu, phát hiện mâu thuẫn, đánh giá độ tin cậy. " +
    "Dùng cho kiểm chứng phức tạp do coordinator giao.",
    { claim: STR, document_ids: { type: "array", items: STR } }, ["claim", "document_ids"]),
];

// ---------- Synthesis agent: viết báo cáo từ kết quả đã có ----------
export const SYNTHESIS_TOOLS: Tool[] = [
  tool("compile_report",
    "Nộp báo cáo cuối có cấu trúc. Gọi tool này là KẾT THÚC phiên synthesis. " +
    "Nhận định chưa kiểm chứng được phải đưa vào needs_coordinator_verification, không được bỏ.",
    {
      title: STR,
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: { heading: STR, body: STR, citations: { type: "array", items: STR } },
          required: ["heading", "body", "citations"],
        },
      },
      needs_coordinator_verification: { type: "array", items: STR },
    },
    ["title", "sections", "needs_coordinator_verification"]),
  tool("verify_fact",
    "[SCOPED] Tra cứu NHANH một dữ kiện đơn giản trong MỘT nguồn (một con số, một ngày, một tên) " +
    "trong kho trích đoạn đã lưu. KHÔNG dùng cho nhận định cần đối chiếu nhiều nguồn, có mâu thuẫn " +
    "hoặc cần đánh giá: trường hợp đó ghi vào needs_coordinator_verification để coordinator xử lý.",
    {
      fact: str("Một dữ kiện đơn, vd 'Tỉ lệ công ty áp dụng hybrid năm 2026 là 62%'"),
      source_url: str("MỘT url nguồn đã lưu"),
    }, ["fact", "source_url"]),
  tool("format_citation",
    "Định dạng trích dẫn theo kiểu APA từ metadata (tác giả, năm, tiêu đề, url).",
    { author: STR, year: STR, title: STR, url: STR }, ["author", "year", "title", "url"]),
  tool("assess_coverage",
    "Đánh giá báo cáo nháp đã trả lời đủ các ý của câu hỏi chưa, liệt kê ý còn thiếu.",
    { question: STR, draft_outline: { type: "array", items: STR } }, ["question", "draft_outline"]),
];

// ---------- Coordinator: chỉ điều phối, không có tool nghiệp vụ ----------
export const COORDINATOR_TOOLS: Tool[] = [
  tool("Agent",
    "Giao việc cho một subagent (web_search | doc_analysis | synthesis). Prompt phải chứa đủ context: " +
    "subagent không thấy hội thoại của coordinator.",
    { agent_type: { type: "string", enum: ["web_search", "doc_analysis", "synthesis"] }, prompt: STR },
    ["agent_type", "prompt"]),
  tool("review_output",
    "Ghi nhận đánh giá của coordinator về kết quả một subagent (đạt / chưa đạt + lý do).",
    { agent_type: STR, verdict: { type: "string", enum: ["pass", "revise"] }, reason: STR },
    ["agent_type", "verdict", "reason"]),
  tool("request_revision",
    "Yêu cầu một subagent làm lại phần chưa đạt, kèm hướng dẫn cụ thể.",
    { agent_type: STR, instructions: STR }, ["agent_type", "instructions"]),
];

export type Role = "coordinator" | "web_search" | "doc_analysis" | "synthesis";

export interface AgentConfig {
  role: string;
  tools: Tool[];
  /** Nhận số thứ tự lượt (1-based) trong phiên của agent. */
  tool_choice: (turn: number) => ToolChoice;
  terminal_tool: string | null;
}

// Chính sách tool_choice theo lượt:
//   web_search  : auto  – có lúc cần trả lời text (tóm tắt nguồn) để kết thúc.
//   doc_analysis: lượt 1 ép extract_metadata (bước bắt buộc, không được bỏ/đảo), sau đó auto.
//   synthesis   : any   – luôn phải gọi tool, không được trả text hội thoại; phiên kết thúc khi
//                 compile_report được gọi (terminal tool), không chờ end_turn.
//   coordinator : auto
export const AGENTS: Record<Role, AgentConfig> = {
  coordinator: {
    role: "Điều phối: chia việc, giao subagent, duyệt kết quả, xử lý kiểm chứng phức tạp.",
    tools: COORDINATOR_TOOLS,
    tool_choice: () => ({ type: "auto" }),
    terminal_tool: null,
  },
  web_search: {
    role: "Tìm nguồn trên web và lưu trích đoạn kèm metadata.",
    tools: WEB_SEARCH_TOOLS,
    tool_choice: () => ({ type: "auto" }),
    terminal_tool: null,
  },
  doc_analysis: {
    role: "Phân tích tài liệu: metadata, số liệu, tóm tắt, kiểm chứng đầy đủ.",
    tools: DOC_ANALYSIS_TOOLS,
    tool_choice: (turn) => (turn === 1 ? { type: "tool", name: "extract_metadata" } : { type: "auto" }),
    terminal_tool: null,
  },
  synthesis: {
    role: "Viết báo cáo cuối từ kết quả của các agent khác.",
    tools: SYNTHESIS_TOOLS,
    tool_choice: () => ({ type: "any" }),
    terminal_tool: "compile_report",
  },
};

export const SUBAGENTS = ["web_search", "doc_analysis", "synthesis"] as const satisfies readonly Role[];

// Tool cross-role có giới hạn: được phép "lấn" sang việc của role khác, nhưng chỉ phần đơn giản.
// verify_fact là bản thu hẹp của verify_claim (doc_analysis).
export const SCOPED_CROSS_ROLE: Record<string, { owner: Role; narrows: string }> = {
  verify_fact: { owner: "synthesis", narrows: "verify_claim" },
};

// Tool nghiệp vụ = mọi tool của 3 subagent. Coordinator không được giữ tool nào trong số này.
export const domainToolNames = (): string[] => SUBAGENTS.flatMap((a) => AGENTS[a].tools.map((t) => t.name));

export function allowedNames(agent: string): string[] {
  const cfg = AGENTS[agent as Role];
  if (!cfg) throw new Error(`Agent không có trong cấu hình: ${agent}`);
  return cfg.tools.map((t) => t.name);
}

export const isRole = (x: unknown): x is Role => typeof x === "string" && Object.hasOwn(AGENTS, x);
