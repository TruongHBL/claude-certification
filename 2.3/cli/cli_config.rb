# frozen_string_literal: true

# Bài 2.3 – bản CLI: sinh cấu hình cho `claude -p` từ ../tool_config.rb.
#
#   agents.json   → --agents   (mỗi agent: description, prompt, tools = đúng tên mcp__research__<tool> của role)
#   mcp.json      → --mcp-config + --strict-mcp-config
#   settings.json → --settings (hook PreToolUse guard_hook.rb cho mọi tool)
#
# Coordinator chạy làm agent của luồng chính (--agent coordinator) để bộ tool của luồng chính
# cũng bị giới hạn bằng trường tools (Agent + 2 tool điều phối), không thấy 12 tool nghiệp vụ.
#
# Tên agent trong Claude Code dùng gạch nối (web-search…); ánh xạ về khoá của ToolConfig ở CLI_TO_ROLE.

require "json"
require "fileutils"
require_relative "../tool_config"
require_relative "../multi_agent_run" # SYSTEM_PROMPTS, QUESTION

module CliConfig
  SERVER = "research"
  ROLE_TO_CLI = { "coordinator" => "coordinator", "web_search" => "web-search",
                  "doc_analysis" => "doc-analysis", "synthesis" => "synthesis" }.freeze
  CLI_TO_ROLE = ROLE_TO_CLI.invert.freeze
  MODEL = ENV.fetch("CLI_MODEL", "haiku")

  module_function

  def mcp_name(tool) = tool == "Agent" ? "Agent" : "mcp__#{SERVER}__#{tool}"

  # Bỏ tiền tố mcp__research__ → tên tool trong ToolConfig.
  def short_name(tool_name) = tool_name.to_s.sub(/\Amcp__#{SERVER}__/o, "")

  def cli_tools(role) = ToolConfig.allowed_names(role).map { |n| mcp_name(n) }

  # Prompt subagent cho bản CLI: thêm tên agent kiểu gạch nối và nhắc ranh giới.
  CLI_PROMPTS = {
    "coordinator" => "Bạn là coordinator của hệ nghiên cứu. Giao việc bằng tool Agent với subagent_type " \
                     "web-search (tìm nguồn) → doc-analysis (phân tích tài liệu) → synthesis (viết báo cáo). " \
                     "Subagent không thấy hội thoại của bạn: truyền đủ câu hỏi, url, document_id, số liệu trong prompt. " \
                     "Nhận định synthesis để trong needs_coordinator_verification là kiểm chứng phức tạp: giao " \
                     "doc-analysis dùng verify_claim. Bạn KHÔNG tự tìm kiếm hay phân tích. Duyệt kết quả bằng " \
                     "review_output rồi trả lời người dùng bằng tiếng Việt."
  }.freeze

  def agent_prompt(role)
    base = CLI_PROMPTS[role] || SYSTEM_PROMPTS.fetch(role)
    "#{base}\nVai trò: #{ToolConfig::AGENTS.fetch(role)[:role]}\n" \
      "Chỉ dùng các tool được cấp cho bạn. Nếu cần việc ngoài vai trò, ghi rõ trong kết quả để coordinator xử lý."
  end

  DESCRIPTIONS = {
    "coordinator" => "Điều phối hệ nghiên cứu: giao việc cho web-search, doc-analysis, synthesis và duyệt kết quả.",
    "web_search" => "Tìm nguồn trên web, tải tài liệu (chỉ tài liệu, qua load_document) và lưu trích đoạn kèm nguồn.",
    "doc_analysis" => "Phân tích tài liệu đã tải: metadata (luôn trước tiên), số liệu, tóm tắt, kiểm chứng đầy đủ nhiều nguồn.",
    "synthesis" => "Viết báo cáo cuối từ kết quả đã có; tra dữ kiện đơn giản một nguồn bằng verify_fact."
  }.freeze

  # misuse: true → CỐ Ý cấu hình sai (cấp search_web cho synthesis + prompt xúi tìm thêm nguồn)
  # để chứng minh lớp hook audit chặn được khi lớp agents.tools bị cấu hình nhầm.
  def agents(misuse: false)
    ROLE_TO_CLI.to_h do |role, cli|
      tools = cli_tools(role)
      prompt = agent_prompt(role)
      if misuse && role == "synthesis"
        tools += [mcp_name("search_web")]
        prompt += "\n(DEMO CẤU HÌNH SAI) Trước khi viết báo cáo, hãy gọi search_web để tìm thêm một nguồn mới."
      end
      spec = { description: DESCRIPTIONS.fetch(role), prompt: prompt, tools: tools, model: MODEL }
      # Subagent nhận mọi thứ qua prompt giao việc (bài 1.3) → bỏ CLAUDE.md của user cho gọn và sạch.
      spec[:omitClaudeMd] = true unless role == "coordinator"
      spec[:background] = false unless role == "coordinator"
      [cli, spec]
    end
  end

  def mcp_config(server_log:)
    { mcpServers: { SERVER => { type: "stdio", command: "ruby",
                                args: [File.expand_path("research_mcp_server.rb", __dir__)],
                                env: { "RESEARCH_LOG" => server_log } } } }
  end

  def settings(hook_log:, state_dir:)
    cmd = "GUARD_LOG=#{hook_log} GUARD_STATE=#{state_dir} ruby #{File.expand_path('guard_hook.rb', __dir__)}"
    { hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: cmd, timeout: 10 }] }] } }
  end

  # Toàn bộ tool phải nằm trong --allowedTools (permission-mode dontAsk từ chối mọi tool không liệt kê).
  # Đây là lớp QUYỀN của cả phiên; lớp phân vai là agents.tools + hook.
  def allowed_tools = (["Agent"] + TOOLS_ALL.map { |n| mcp_name(n) }).uniq

  TOOLS_ALL = ToolConfig::AGENTS.values.flat_map { |a| a[:tools].map { |t| t[:name] } }.reject { |n| n == "Agent" }.uniq.freeze

  def write_all(dir, misuse: false)
    FileUtils.mkdir_p(dir)
    files = {
      "agents.json" => agents(misuse: misuse),
      "mcp.json" => mcp_config(server_log: File.join(dir, "server.jsonl")),
      "settings.json" => settings(hook_log: File.join(dir, "hook.jsonl"), state_dir: File.join(dir, "state"))
    }
    files.each { |name, data| File.write(File.join(dir, name), JSON.pretty_generate(data)) }
    File.write(File.join(dir, "allowed_tools.txt"), allowed_tools.join(","))
    File.write(File.join(dir, "question.txt"), QUESTION)
    dir
  end
end

if $PROGRAM_NAME == __FILE__
  dir = ARGV.find { |a| !a.start_with?("--") } or abort "Dùng: ruby cli_config.rb <thư_mục_ra> [--misuse]"
  puts CliConfig.write_all(File.expand_path(dir), misuse: ARGV.include?("--misuse"))
end
