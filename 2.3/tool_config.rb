# frozen_string_literal: true

# Bài 2.3 – Build Exercise: phân bổ tool theo vai trò + tool_choice.
#
# File này là "cấu hình" của hệ đa agent: mỗi agent có bộ tool riêng (4–5 tool),
# chính sách tool_choice theo từng lượt, và danh sách tool cross-role có giới hạn (scoped).
# config_check.rb kiểm tra cấu hình này; multi_agent_run.rb dùng nó để chạy.

module ToolConfig
  def self.tool(name, description, properties, required)
    { name: name, description: description,
      input_schema: { type: "object", properties: properties, required: required } }
  end

  STR = { type: "string" }.freeze

  # ---------- Web Search agent: tìm và lấy tài liệu từ web ----------
  WEB_SEARCH_TOOLS = [
    tool("search_web",
         "Tìm kiếm web theo từ khoá. Trả về tối đa 5 kết quả {title, url, snippet}. " \
         "Dùng để tìm NGUỒN mới. Không dùng để đọc nội dung chi tiết của một trang (dùng load_document).",
         { query: STR.merge(description: "Từ khoá tìm kiếm, 3–12 từ") }, %w[query]),
    tool("load_document",
         "Tải nội dung MỘT tài liệu (pdf, docx, md, txt, html) qua https từ domain đã duyệt. " \
         "Thay thế cho fetch_url: từ chối ảnh, API JSON, http, localhost/IP nội bộ với lỗi validation/permission " \
         "(isRetryable=false). Không dùng để gọi API hay tải file bất kỳ.",
         { url: STR.merge(description: "URL https trỏ tới tài liệu, vd https://www.gso.gov.vn/bao-cao.pdf") }, %w[url]),
    tool("extract_links",
         "Lấy danh sách liên kết tài liệu (pdf/docx/html) trong một tài liệu ĐÃ tải bằng load_document. " \
         "Không tự tải trang mới.",
         { document_id: STR.merge(description: "document_id do load_document trả về") }, %w[document_id]),
    tool("save_snippet",
         "Lưu một đoạn trích kèm metadata nguồn (url, tiêu đề, vị trí) để chuyển cho các agent sau. " \
         "Mọi trích dẫn đưa ra ngoài phải được lưu qua tool này.",
         { url: STR, quote: STR, location: STR.merge(description: "trang/đoạn, vd 'tr. 12'") }, %w[url quote location])
  ].freeze

  # ---------- Document Analysis agent: phân tích tài liệu đã có ----------
  DOC_ANALYSIS_TOOLS = [
    tool("extract_metadata",
         "BƯỚC BẮT BUỘC ĐẦU TIÊN cho mỗi tài liệu: lấy tiêu đề, tác giả/tổ chức, ngày xuất bản, loại tài liệu. " \
         "Các bước sau (trích số liệu, tóm tắt, kiểm chứng) dựa trên metadata này để ghi nguồn.",
         { document_id: STR }, %w[document_id]),
    tool("extract_data_points",
         "Trích các số liệu định lượng (con số, tỉ lệ, năm, mẫu khảo sát) từ một tài liệu, kèm vị trí trong tài liệu.",
         { document_id: STR, topic: STR.merge(description: "Chủ đề cần trích số liệu") }, %w[document_id topic]),
    tool("summarize_content",
         "Tóm tắt nội dung một tài liệu trong 3–5 ý, giữ nguyên quan điểm của tác giả, không thêm nhận định.",
         { document_id: STR }, %w[document_id]),
    tool("verify_claim",
         "Kiểm chứng ĐẦY ĐỦ một nhận định: đối chiếu nhiều tài liệu, phát hiện mâu thuẫn, đánh giá độ tin cậy. " \
         "Dùng cho kiểm chứng phức tạp do coordinator giao.",
         { claim: STR, document_ids: { type: "array", items: STR } }, %w[claim document_ids])
  ].freeze

  # ---------- Synthesis agent: viết báo cáo từ kết quả đã có ----------
  SYNTHESIS_TOOLS = [
    tool("compile_report",
         "Nộp báo cáo cuối có cấu trúc. Gọi tool này là KẾT THÚC phiên synthesis. " \
         "Nhận định chưa kiểm chứng được phải đưa vào needs_coordinator_verification, không được bỏ.",
         { title: STR,
           sections: { type: "array", items: { type: "object",
                                               properties: { heading: STR, body: STR,
                                                             citations: { type: "array", items: STR } },
                                               required: %w[heading body citations] } },
           needs_coordinator_verification: { type: "array", items: STR } },
         %w[title sections needs_coordinator_verification]),
    tool("verify_fact",
         "[SCOPED] Tra cứu NHANH một dữ kiện đơn giản trong MỘT nguồn (một con số, một ngày, một tên) " \
         "trong kho trích đoạn đã lưu. KHÔNG dùng cho nhận định cần đối chiếu nhiều nguồn, có mâu thuẫn " \
         "hoặc cần đánh giá: trường hợp đó ghi vào needs_coordinator_verification để coordinator xử lý.",
         { fact: STR.merge(description: "Một dữ kiện đơn, vd 'Tỉ lệ công ty áp dụng hybrid năm 2026 là 62%'"),
           source_url: STR.merge(description: "MỘT url nguồn đã lưu") }, %w[fact source_url]),
    tool("format_citation",
         "Định dạng trích dẫn theo kiểu APA từ metadata (tác giả, năm, tiêu đề, url).",
         { author: STR, year: STR, title: STR, url: STR }, %w[author year title url]),
    tool("assess_coverage",
         "Đánh giá báo cáo nháp đã trả lời đủ các ý của câu hỏi chưa, liệt kê ý còn thiếu.",
         { question: STR, draft_outline: { type: "array", items: STR } }, %w[question draft_outline])
  ].freeze

  # ---------- Coordinator: chỉ điều phối, không có tool nghiệp vụ ----------
  COORDINATOR_TOOLS = [
    tool("Agent",
         "Giao việc cho một subagent (web_search | doc_analysis | synthesis). Prompt phải chứa đủ context: " \
         "subagent không thấy hội thoại của coordinator.",
         { agent_type: { type: "string", enum: %w[web_search doc_analysis synthesis] }, prompt: STR },
         %w[agent_type prompt]),
    tool("review_output",
         "Ghi nhận đánh giá của coordinator về kết quả một subagent (đạt / chưa đạt + lý do).",
         { agent_type: STR, verdict: { type: "string", enum: %w[pass revise] }, reason: STR },
         %w[agent_type verdict reason]),
    tool("request_revision",
         "Yêu cầu một subagent làm lại phần chưa đạt, kèm hướng dẫn cụ thể.",
         { agent_type: STR, instructions: STR }, %w[agent_type instructions])
  ].freeze

  # Chính sách tool_choice: lambda nhận số thứ tự lượt (1-based) trong phiên của agent.
  #   web_search  : auto  – có lúc cần trả lời text (tóm tắt nguồn) để kết thúc.
  #   doc_analysis: lượt 1 ép extract_metadata (bước bắt buộc, không được bỏ/đảo), sau đó auto.
  #   synthesis   : any   – luôn phải gọi tool, không được trả text hội thoại; phiên kết thúc khi
  #                 compile_report được gọi (terminal tool), không chờ end_turn.
  #   coordinator : auto
  AGENTS = {
    "coordinator" => {
      role: "Điều phối: chia việc, giao subagent, duyệt kết quả, xử lý kiểm chứng phức tạp.",
      tools: COORDINATOR_TOOLS,
      tool_choice: ->(_turn) { { type: "auto" } },
      terminal_tool: nil
    },
    "web_search" => {
      role: "Tìm nguồn trên web và lưu trích đoạn kèm metadata.",
      tools: WEB_SEARCH_TOOLS,
      tool_choice: ->(_turn) { { type: "auto" } },
      terminal_tool: nil
    },
    "doc_analysis" => {
      role: "Phân tích tài liệu: metadata, số liệu, tóm tắt, kiểm chứng đầy đủ.",
      tools: DOC_ANALYSIS_TOOLS,
      tool_choice: ->(turn) { turn == 1 ? { type: "tool", name: "extract_metadata" } : { type: "auto" } },
      terminal_tool: nil
    },
    "synthesis" => {
      role: "Viết báo cáo cuối từ kết quả của các agent khác.",
      tools: SYNTHESIS_TOOLS,
      tool_choice: ->(_turn) { { type: "any" } },
      terminal_tool: "compile_report"
    }
  }.freeze

  # Tool cross-role có giới hạn: được phép "lấn" sang việc của role khác, nhưng chỉ phần đơn giản.
  # verify_fact là bản thu hẹp của verify_claim (doc_analysis).
  SCOPED_CROSS_ROLE = { "verify_fact" => { owner: "synthesis", narrows: "verify_claim" } }.freeze

  # Tool nghiệp vụ = mọi tool của 3 subagent. Coordinator không được giữ tool nào trong số này.
  def self.domain_tool_names
    %w[web_search doc_analysis synthesis].flat_map { |a| AGENTS[a][:tools].map { |t| t[:name] } }
  end

  def self.allowed_names(agent) = AGENTS.fetch(agent)[:tools].map { |t| t[:name] }
end
