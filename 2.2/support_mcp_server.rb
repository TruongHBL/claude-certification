#!/usr/bin/env ruby
# frozen_string_literal: true

# Bài 2.2 – MCP server "support" (stdio, JSON-RPC 2.0, Ruby thuần, không cần gem).
#
# Hai tool:
#   get_customer(customer_id, simulate?)  – tra hồ sơ khách trong DB giả
#   process_refund(customer_id, amount)   – hoàn tiền, hạn mức tự động 500 USD
#
# Hai lớp lỗi:
#   1. Protocol error (JSON-RPC `error`): tool không tồn tại, thiếu tham số bắt buộc. Không có tool nào chạy,
#      model không nhận được tool result. Sửa ở schema/client, không phải ở vòng hồi phục của agent.
#   2. Tool execution error (`result.isError: true`): tool đã chạy nhưng thất bại. Metadata nằm trong
#      structuredContent: { errorCategory, isRetryable, description }. Đây là QUY ƯỚC CỦA ỨNG DỤNG,
#      MCP spec chỉ định nghĩa content / structuredContent / isError.
#
# Lưu ý: customer_id KHÔNG khai báo `pattern` trong inputSchema. Nếu schema chặn định dạng thì client/SDK
# có thể từ chối ngay ở lớp giao thức và agent không bao giờ thấy lỗi validation có hướng dẫn sửa.
# Định dạng được kiểm trong code để trả lỗi validation có cấu trúc.
#
# Tham số simulate (chỉ để kích hoạt lỗi theo yêu cầu):
#   none (mặc định) | timeout (luôn timeout) | flaky:N (N lần đầu timeout, sau đó chạy bình thường)
#   | permission (giả lập service account bị thu quyền)
#
# Biến môi trường:
#   ERROR_STYLE=structured (mặc định) | bad   – bad: mọi lỗi chỉ là chuỗi "Error", kết quả rỗng cũng là "Error"
#   SUPPORT_LOG=<file>                         – mỗi tools/call ghi 1 dòng JSON

require "json"
require "time"

ERROR_STYLE = ENV.fetch("ERROR_STYLE", "structured")
LOG_FILE = ENV["SUPPORT_LOG"]
REFUND_LIMIT = 500

# Dữ liệu GIẢ.
CUSTOMERS = {
  "CUS-0012" => { customer_id: "CUS-0012", name: "Nguyễn Thị Lan", tier: "Vàng", balance_usd: 120.0,
                  orders: ["#12345", "#31007"], restricted: false },
  "CUS-0042" => { customer_id: "CUS-0042", name: "Trần Văn Minh", tier: "Bạc", balance_usd: 0.0,
                  orders: ["#20871"], restricted: false },
  # Hồ sơ thuộc nhóm tài chính bị hạn chế: service account của agent không có quyền đọc.
  "CUS-0777" => { customer_id: "CUS-0777", name: "Công ty TNHH Hoà Phát Đạt", tier: "Doanh nghiệp",
                  balance_usd: 15_400.0, orders: ["#45210"], restricted: true }
}.freeze

TOOLS = [
  { name: "get_customer",
    description: <<~DESC.strip,
      Tra hồ sơ khách hàng theo mã khách dạng CUS-NNNN (vd CUS-0012): tên, hạng, số dư, danh sách mã đơn.
      Không có khách khớp thì trả kết quả rỗng (resultCount = 0, KHÔNG phải lỗi): đừng gọi lại, hãy báo không tìm thấy.
      Khi lỗi, structuredContent có errorCategory, isRetryable, description: làm theo description.
    DESC
    inputSchema: { type: "object",
                   properties: {
                     customer_id: { type: "string", description: "Mã khách dạng CUS-NNNN, vd CUS-0012" },
                     simulate: { type: "string", description: "Chỉ dùng khi test: none | timeout | flaky:N | permission" }
                   },
                   required: ["customer_id"] } },
  { name: "process_refund",
    description: <<~DESC.strip,
      Hoàn tiền cho khách (USD). Tự động duyệt tối đa #{REFUND_LIMIT} USD; vượt hạn mức trả lỗi business, không gọi lại mà chuyển quản lý duyệt.
      Input: customer_id dạng CUS-NNNN, amount là số dương.
    DESC
    inputSchema: { type: "object",
                   properties: {
                     customer_id: { type: "string", description: "Mã khách dạng CUS-NNNN" },
                     amount: { type: "number", description: "Số tiền hoàn (USD), > 0" }
                   },
                   required: ["customer_id", "amount"] } }
].freeze

ID_FORMAT = /\ACUS-\d{4}\z/
$flaky_counts = Hash.new(0) # (customer_id, simulate) → số lần đã gọi, để flaky:N hết lỗi sau N lần

def log_call(name, args)
  return unless LOG_FILE

  File.open(LOG_FILE, "a") { |f| f.puts JSON.generate({ at: Time.now.iso8601(3), tool: name, arguments: args }) }
end

# ---- Hai kiểu trả lỗi -------------------------------------------------------------------------

def tool_error(category, retryable, description)
  return { content: [{ type: "text", text: "Error" }], isError: true } if ERROR_STYLE == "bad"

  meta = { errorCategory: category, isRetryable: retryable, description: description }
  { content: [{ type: "text", text: JSON.generate(meta) }], structuredContent: meta, isError: true }
end

def tool_ok(data)
  { content: [{ type: "text", text: JSON.generate(data) }], structuredContent: data, isError: false }
end

def valid_empty(customer_id)
  # Bản bad: "không có kết quả" trông y hệt lỗi, agent không phân biệt được.
  return { content: [{ type: "text", text: "Error" }], isError: true } if ERROR_STYLE == "bad"

  tool_ok({ results: [], resultCount: 0,
            message: "Truy vấn đã chạy thành công, không có khách nào có mã #{customer_id}. Không cần gọi lại." })
end

# ---- Các lỗi theo 4 loại ----------------------------------------------------------------------

def transient_timeout
  tool_error("transient", true,
             "Kết nối DB khách hàng bị timeout sau 5s, truy vấn CHƯA chạy (dữ liệu có thể vẫn tồn tại). " \
             "Yêu cầu hợp lệ: gọi lại nguyên văn sau vài trăm ms.")
end

def validation_bad_id(raw)
  tool_error("validation", false,
             "customer_id '#{raw}' sai định dạng. Định dạng đúng: CUS + gạch ngang + 4 chữ số, vd CUS-0012. " \
             "Gọi lại y nguyên sẽ lỗi tiếp: hãy sửa input rồi gọi lại, hoặc hỏi lại khách mã đúng.")
end

def permission_denied(customer_id)
  tool_error("permission", false,
             "Service account support-bot không có quyền đọc hồ sơ tài chính của #{customer_id}. " \
             "Gọi lại với cùng tài khoản sẽ vẫn bị từ chối: chuyển cho nhân viên cấp cao có quyền finance-read.")
end

def simulated_failure(customer_id, simulate)
  case simulate
  when nil, "", "none" then nil
  when "timeout" then transient_timeout
  when "permission" then permission_denied(customer_id)
  when /\Aflaky:(\d+)\z/
    key = [customer_id, simulate]
    $flaky_counts[key] += 1
    $flaky_counts[key] <= Regexp.last_match(1).to_i ? transient_timeout : nil
  else
    tool_error("validation", false,
               "simulate '#{simulate}' không hợp lệ. Giá trị cho phép: none, timeout, flaky:N, permission.")
  end
end

def get_customer(args)
  id = args["customer_id"].to_s
  return validation_bad_id(id) unless id.match?(ID_FORMAT)

  failure = simulated_failure(id, args["simulate"])
  return failure if failure

  customer = CUSTOMERS[id]
  return valid_empty(id) unless customer
  return permission_denied(id) if customer[:restricted]

  tool_ok({ results: [customer.reject { |k, _| k == :restricted }], resultCount: 1 })
end

def process_refund(args)
  id = args["customer_id"].to_s
  amount = args["amount"]
  return validation_bad_id(id) unless id.match?(ID_FORMAT)
  unless amount.is_a?(Numeric) && amount.positive?
    return tool_error("validation", false, "amount '#{amount}' không hợp lệ: phải là số dương (USD), vd 49.5.")
  end

  customer = CUSTOMERS[id]
  unless customer
    return tool_error("validation", false,
                      "Không có khách #{id} nên không thể hoàn tiền. Kiểm tra lại mã khách bằng get_customer trước.")
  end
  return permission_denied(id) if customer[:restricted]

  if amount > REFUND_LIMIT
    return tool_error("business", false,
                      "Khoản hoàn #{format('%.2f', amount)} USD vượt hạn mức tự động #{REFUND_LIMIT} USD, cần quản lý duyệt. " \
                      "KHÔNG gọi lại: tạo yêu cầu duyệt cho quản lý kèm mã khách, số tiền, lý do; " \
                      "báo khách rằng yêu cầu đang chờ duyệt trong 1 ngày làm việc.")
  end

  tool_ok({ refund_id: "RF-#{id[-4..]}-#{(amount * 100).to_i}", customer_id: id, amount_usd: amount,
            status: "approved" })
end

def call_tool(name, args)
  log_call(name, args)
  case name
  when "get_customer" then get_customer(args)
  when "process_refund" then process_refund(args)
  end
end

# ---- JSON-RPC ---------------------------------------------------------------------------------

def respond(id, result) = $stdout.puts(JSON.generate({ jsonrpc: "2.0", id: id, result: result }))

def respond_error(id, code, message)
  $stdout.puts(JSON.generate({ jsonrpc: "2.0", id: id, error: { code: code, message: message } }))
end

$stdout.sync = true
$stdin.each_line do |line|
  next if line.strip.empty?

  begin
    msg = JSON.parse(line)
  rescue JSON::ParserError
    respond_error(nil, -32_700, "Parse error")
    next
  end
  id = msg["id"]
  case msg["method"]
  when "initialize"
    respond(id, { protocolVersion: msg.dig("params", "protocolVersion") || "2025-06-18",
                  capabilities: { tools: {} }, serverInfo: { name: "support", version: "1.0.0" } })
  when "notifications/initialized", "notifications/cancelled"
    nil
  when "ping"
    respond(id, {})
  when "tools/list"
    respond(id, { tools: TOOLS })
  when "tools/call"
    name = msg.dig("params", "name")
    args = msg.dig("params", "arguments") || {}
    tool = TOOLS.find { |t| t[:name] == name }
    # Lớp 1 – protocol error: tool không tồn tại hoặc thiếu tham số bắt buộc → tool không chạy.
    if tool.nil?
      respond_error(id, -32_602, "Unknown tool: #{name}")
    elsif (missing = tool[:inputSchema][:required] - args.keys).any?
      respond_error(id, -32_602, "Invalid params for #{name}: missing #{missing.join(', ')}")
    else
      respond(id, call_tool(name, args))
    end
  else
    respond_error(id, -32_601, "Method not found: #{msg['method']}") unless id.nil?
  end
end
