#!/usr/bin/env ruby
# frozen_string_literal: true

# Bài 2.2 – Vòng hồi phục đọc metadata lỗi và rẽ nhánh.
#
# Đây là logic TẤT ĐỊNH bằng code: không gọi model, nên chạy thật được ngay. Nó đóng vai phần
# "agent" quyết định sau mỗi tool result. (Phần để LLM tự quyết dựa vào cùng metadata: xem run_llm.sh.)
#
#   isRetryable = true  (transient)  → gọi lại nguyên văn, tối đa 3 lần, backoff 0.2s → 0.4s → 0.8s
#   validation                       → sửa input (chuẩn hoá mã khách) rồi gọi lại 1 lần; không sửa được → hỏi lại khách
#   business                         → KHÔNG gọi lại, escalate kèm handoff (mã khách, số tiền, lý do)
#   permission                       → KHÔNG gọi lại, xin quyền cao hơn / chuyển nhân viên có quyền
#   isError=false, resultCount=0     → kết quả rỗng hợp lệ: trả lời "không tìm thấy", KHÔNG gọi lại
#   JSON-RPC error (lớp giao thức)    → tool không chạy: lỗi ở schema/client, báo dev, không vòng hồi phục
#
# Quy ước đếm: 1 lần gọi đầu + tối đa 3 lần retry = tối đa 4 lần gọi cho lỗi transient.
#
# Chạy:  ruby recovery_agent.rb                 # bản structured rồi bản bad, in bảng so sánh
#        ruby recovery_agent.rb structured|bad   # chỉ một bản
#        BACKOFF_SCALE=0.01 ruby recovery_agent.rb   # chạy nhanh (delay ×0.01)

require "json"
require "open3"

SERVER = File.join(__dir__, "support_mcp_server.rb")
MAX_RETRIES = 3
BASE_DELAY = 0.2
BACKOFF_SCALE = Float(ENV.fetch("BACKOFF_SCALE", "1"))

class McpClient
  attr_reader :calls

  def initialize(error_style)
    env = { "ERROR_STYLE" => error_style }
    env["SUPPORT_LOG"] = ENV["SUPPORT_LOG"] if ENV["SUPPORT_LOG"]
    @stdin, @stdout, @wait = Open3.popen2(env, RbConfig.ruby, SERVER)
    @id = 0
    @calls = 0
    rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "recovery-agent" } })
    @stdin.puts JSON.generate({ jsonrpc: "2.0", method: "notifications/initialized" })
  end

  def rpc(method, params)
    @id += 1
    @stdin.puts JSON.generate({ jsonrpc: "2.0", id: @id, method: method, params: params })
    JSON.parse(@stdout.gets)
  end

  def call_tool(name, args)
    @calls += 1
    rpc("tools/call", { name: name, arguments: args })
  end

  def close
    @stdin.close
    @wait.value
  end
end

# Thử sửa mã khách sai định dạng: "cus 12", "cus-0012", "CUS12" → "CUS-0012". Không đoán được thì nil.
def fix_customer_id(raw)
  m = raw.to_s.strip.match(/\Acus[\s\-_]*(\d{1,4})\z/i)
  m && format("CUS-%04d", m[1].to_i)
end

def metadata_of(result)
  result["structuredContent"] || (JSON.parse(result.dig("content", 0, "text").to_s) rescue nil)
end

# ---- Agent đọc metadata -----------------------------------------------------------------------

def handle_structured(client, tool, args, log)
  retries = 0
  fixed = false
  delays = []
  loop do
    resp = client.call_tool(tool, args)
    if resp["error"]
      log << "  ✗ lớp giao thức #{resp['error']['code']}: #{resp['error']['message']} → tool không chạy, báo dev sửa schema/client"
      return { outcome: :protocol_error, delays: delays }
    end

    result = resp["result"]
    meta = metadata_of(result)
    unless result["isError"]
      if meta["resultCount"]&.zero?
        log << "  ○ rỗng hợp lệ (isError=false, resultCount=0) → trả lời khách: không tìm thấy, KHÔNG gọi lại"
        return { outcome: :not_found, delays: delays }
      end
      log << "  ✓ thành công: #{JSON.generate(meta)[0, 110]}"
      return { outcome: :success, data: meta, delays: delays }
    end

    category = meta["errorCategory"]
    log << "  ! #{category} (isRetryable=#{meta['isRetryable']}): #{meta['description'][0, 90]}…"
    if meta["isRetryable"]
      if retries >= MAX_RETRIES
        log << "  ✗ hết #{MAX_RETRIES} lần retry → báo lên: đã thử #{client.calls} lần, lỗi transient, chưa có dữ liệu"
        return { outcome: :gave_up, attempted: retries + 1, delays: delays }
      end
      delay = BASE_DELAY * (2**retries) * BACKOFF_SCALE
      retries += 1
      delays << delay
      log << "    ↻ retry #{retries}/#{MAX_RETRIES} sau #{format('%.2f', delay / BACKOFF_SCALE)}s"
      sleep delay
      next
    end

    case category
    when "validation"
      candidate = fix_customer_id(args["customer_id"])
      if !fixed && candidate && candidate != args["customer_id"]
        log << "    ✎ sửa input customer_id '#{args['customer_id']}' → '#{candidate}' rồi gọi lại (lần gọi mới, không phải retry)"
        args = args.merge("customer_id" => candidate)
        fixed = true
        next
      end
      log << "  ? không tự sửa được → hỏi lại khách mã đúng (dạng CUS-NNNN)"
      return { outcome: :ask_user, delays: delays }
    when "business"
      handoff = { customer_id: args["customer_id"], amount_usd: args["amount"], reason: meta["description"],
                  recommended_action: "Quản lý duyệt hoàn tiền vượt hạn mức" }
      log << "  ⇧ escalate cho quản lý, KHÔNG retry. Handoff: #{JSON.generate(handoff)[0, 120]}…"
      return { outcome: :escalated, handoff: handoff, delays: delays }
    when "permission"
      log << "  🔑 xin quyền finance-read / chuyển nhân viên cấp cao, KHÔNG retry với cùng tài khoản"
      return { outcome: :need_credentials, delays: delays }
    else
      log << "  ✗ errorCategory lạ '#{category}' → escalate"
      return { outcome: :escalated, delays: delays }
    end
  end
end

# ---- Agent "ngây thơ" với lỗi kiểu cũ: chỉ biết isError + chữ "Error" ---------------------------
# Không có category hay isRetryable, cách duy nhất là đoán: thử lại 3 lần rồi chuyển người.

def handle_naive(client, tool, args, log)
  retries = 0
  delays = []
  loop do
    resp = client.call_tool(tool, args)
    if resp["error"]
      log << "  ✗ lớp giao thức: #{resp['error']['message']}"
      return { outcome: :protocol_error, delays: delays }
    end
    result = resp["result"]
    unless result["isError"]
      log << "  ✓ thành công"
      return { outcome: :success, delays: delays }
    end
    log << "  ! \"#{result.dig('content', 0, 'text')}\" (không biết loại lỗi, không biết có nên thử lại)"
    if retries >= MAX_RETRIES
      log << "  ⇧ thử #{client.calls} lần vẫn lỗi → chuyển người xử lý"
      return { outcome: :escalated, delays: delays }
    end
    delay = BASE_DELAY * (2**retries) * BACKOFF_SCALE
    retries += 1
    delays << delay
    log << "    ↻ đoán là lỗi tạm thời, thử lại #{retries}/#{MAX_RETRIES}"
    sleep delay
  end
end

# ---- Kịch bản ---------------------------------------------------------------------------------

SCENARIOS = [
  { id: 1, name: "Tra khách bình thường", tool: "get_customer", args: { "customer_id" => "CUS-0012" },
    expect: :success, expect_calls: 1 },
  { id: 2, name: "Khách không tồn tại (rỗng hợp lệ)", tool: "get_customer", args: { "customer_id" => "CUS-9999" },
    expect: :not_found, expect_calls: 1 },
  { id: 3, name: "DB chập chờn: timeout 2 lần rồi được", tool: "get_customer",
    args: { "customer_id" => "CUS-0042", "simulate" => "flaky:2" }, expect: :success, expect_calls: 3 },
  { id: 4, name: "DB sập: timeout mãi", tool: "get_customer",
    args: { "customer_id" => "CUS-0012", "simulate" => "timeout" }, expect: :gave_up, expect_calls: 4 },
  { id: 5, name: "Mã khách gõ sai nhưng sửa được", tool: "get_customer", args: { "customer_id" => "cus 12" },
    expect: :success, expect_calls: 2 },
  { id: 6, name: "Mã khách sai không đoán được", tool: "get_customer", args: { "customer_id" => "order-abc" },
    expect: :ask_user, expect_calls: 1 },
  { id: 7, name: "Hoàn 750 USD (vượt hạn mức 500)", tool: "process_refund",
    args: { "customer_id" => "CUS-0012", "amount" => 750 }, expect: :escalated, expect_calls: 1 },
  { id: 8, name: "Hồ sơ tài chính bị hạn chế", tool: "get_customer", args: { "customer_id" => "CUS-0777" },
    expect: :need_credentials, expect_calls: 1 },
  { id: 9, name: "Hoàn 49.5 USD (trong hạn mức)", tool: "process_refund",
    args: { "customer_id" => "CUS-0012", "amount" => 49.5 }, expect: :success, expect_calls: 1 },
  { id: 10, name: "Gọi tool không tồn tại (lớp giao thức)", tool: "get_custmer",
    args: { "customer_id" => "CUS-0012" }, expect: :protocol_error, expect_calls: 1 }
].freeze

# Mỗi kịch bản một server mới để bộ đếm flaky và số lần gọi tách bạch.
def run_scenario(style, sc)
  client = McpClient.new(style)
  log = []
  result = style == "bad" ? handle_naive(client, sc[:tool], sc[:args].dup, log) : handle_structured(client, sc[:tool], sc[:args].dup, log)
  result.merge(calls: client.calls, log: log)
ensure
  client&.close
end

# Lan truyền lỗi có chọn lọc: tra nhiều khách, khách nào lỗi hết retry thì báo lên kèm kết quả phần còn lại.
def run_batch(style)
  ids = [["CUS-0012", nil], ["CUS-0042", "timeout"], ["CUS-9999", nil]]
  client = McpClient.new(style)
  found = []
  failed = []
  empty = []
  log = []
  ids.each do |id, sim|
    args = { "customer_id" => id }
    args["simulate"] = sim if sim
    r = style == "bad" ? handle_naive(client, "get_customer", args, log) : handle_structured(client, "get_customer", args, log)
    case r[:outcome]
    when :success then found << id
    when :not_found then empty << id
    else failed << { customer_id: id, outcome: r[:outcome] }
    end
  end
  report = { searched: ids.size, found: found, not_found: empty, failed: failed, total_calls: client.calls }
  { report: report, log: log }
ensure
  client&.close
end

def run_style(style)
  puts "\n================ ERROR_STYLE=#{style} ================"
  SCENARIOS.map do |sc|
    r = run_scenario(style, sc)
    puts "\n[#{sc[:id]}] #{sc[:name]}  (#{sc[:tool]} #{JSON.generate(sc[:args])})"
    r[:log].each { |l| puts l }
    puts "  → kết cục: #{r[:outcome]} sau #{r[:calls]} lần gọi"
    [sc[:id], r]
  end.to_h
end

if $PROGRAM_NAME == __FILE__
  styles = ARGV.empty? ? %w[structured bad] : ARGV
  results = styles.to_h { |s| [s, run_style(s)] }

  styles.each do |s|
    b = run_batch(s)
    puts "\n[Lan truyền lỗi, #{s}] tra 3 khách, CUS-0042 bị timeout mãi:"
    puts "  Báo cáo gửi coordinator: #{JSON.generate(b[:report])}"
  end

  if styles.size == 2
    puts "\n================ SO SÁNH ================"
    puts format("%-4s %-40s %-26s %-26s", "#", "Kịch bản", "structured", "bad")
    SCENARIOS.each do |sc|
      a = results["structured"][sc[:id]]
      b = results["bad"][sc[:id]]
      puts format("%-4s %-40s %-26s %-26s", sc[:id], sc[:name][0, 40], "#{a[:outcome]} (#{a[:calls]} lần)",
                  "#{b[:outcome]} (#{b[:calls]} lần)")
    end
    total = ->(s) { results[s].values.sum { |r| r[:calls] } }
    puts "Tổng số lần gọi tool: structured #{total.('structured')}, bad #{total.('bad')}"
  end
end
