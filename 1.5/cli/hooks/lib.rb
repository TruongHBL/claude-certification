# frozen_string_literal: true
# Tiện ích chung cho shell hook bài 1.5 (bản CLI).
# Mỗi hook là MỘT TIẾN TRÌNH RIÊNG do Claude Code chạy: input JSON qua stdin, output qua stdout + exit code.
# Vì vậy state (AML đã pass, hàng đợi escalation) phải nằm trên đĩa, không giữ trong bộ nhớ như bản SDK.
require "json"
require "fileutils"

REFUND_LIMIT_USD = 500
STATE_DIR = ENV["HOOK_STATE_DIR"] || File.expand_path("../state", __dir__)
FileUtils.mkdir_p(STATE_DIR)

def hook_input = JSON.parse($stdin.read)
def short_name(full) = full.to_s.sub(/\Amcp__ops__/, "")

# exit 0 + JSON permissionDecision "deny": tool không chạy, lý do được đưa cho Claude.
# (Cách khác: in lý do ra stderr rồi exit 2. Exit 1 KHÔNG chặn.)
def deny!(reason)
  puts JSON.generate({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } })
  exit 0
end

def append_jsonl(file, obj) = File.open(File.join(STATE_DIR, file), "a") { _1.puts(JSON.generate(obj)) }

# tool_response của MCP tool có thể là chuỗi, mảng content block, hoặc { content: [...] } → đọc cả 3
def read_payload(resp)
  blocks = resp.is_a?(Array) ? resp : (resp.is_a?(Hash) ? resp["content"] : nil)
  t = resp.is_a?(String) ? resp : Array(blocks).find { _1.is_a?(Hash) && _1["type"] == "text" }&.dig("text")
  t && JSON.parse(t)
rescue JSON::ParserError
  nil
end

# Trả lại đúng "hình dạng" đã nhận, chỉ thay nội dung
def write_payload(resp, data)
  t = JSON.generate(data)
  return t if resp.is_a?(String)
  return [{ type: "text", text: t }] if resp.is_a?(Array)
  resp.merge("content" => [{ type: "text", text: t }])
end
