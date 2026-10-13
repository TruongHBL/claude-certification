#!/usr/bin/env bash
# Bài 1.5 – biến thể THUẦN CLI: shell hook (cli/hooks/*.rb) + MCP server Ruby (cli/ops_mcp_server.rb),
# chạy bằng `claude -p --settings cli/settings.cli.json`. Không cần Node/SDK, không cần API key.
#
# Dùng:  ./run_cli_hooks.sh          chạy 3 prompt, in LEDGER (tool tiền tệ đã chạy thật) + escalation
#        ./run_cli_hooks.sh clean    xoá cli/state và results-cli/
#
# Chi phí ước tính: 3 lệnh, model haiku, mỗi lệnh ~15–30k token input (system prompt CLI + 6 tool) →
# ~0,05–0,2 USD tương đương giá API; mỗi lệnh chặn trần bằng --max-budget-usd.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$ROOT/cli/state"; RESULTS="$ROOT/results-cli"
MODEL="${MODEL:-haiku}"; BUDGET="${BUDGET:-0.2}"; CLAUDE_BIN="${CLAUDE_BIN:-claude}"

if [ "${1:-}" = "clean" ]; then rm -rf "$STATE" "$RESULTS"; echo "đã xoá"; exit 0; fi

unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
"$CLAUDE_BIN" auth status 2>/dev/null | ruby -rjson -e 'exit(JSON.parse($stdin.read)["loggedIn"] == true ? 0 : 1)' \
  || { echo "Claude Code chưa đăng nhập. Chạy: claude  rồi gõ /login"; exit 1; }

rm -rf "$STATE" "$RESULTS"; mkdir -p "$STATE" "$RESULTS"
export HOOK_STATE_DIR="$STATE"              # hook là tiến trình riêng, kế thừa env của claude
MCP="$RESULTS/mcp.json"
ruby -rjson -e 'puts JSON.pretty_generate({ mcpServers: { ops: { type: "stdio", command: "ruby", args: [ARGV[0]],
                  env: { LEDGER_FILE: ARGV[1] } } } })' "$ROOT/cli/ops_mcp_server.rb" "$STATE/ledger.txt" > "$MCP"

TOOLS="mcp__ops__get_order,mcp__ops__get_shipment,mcp__ops__get_payment,mcp__ops__process_refund,mcp__ops__aml_check,mcp__ops__transfer_funds"
PROMPTS=(
  "Đơn ORD-1001: cho tôi biết ngày tạo đơn, ngày gửi hàng, ngày thanh toán và trạng thái của từng thứ."
  "Hoàn tiền \$750 cho đơn ORD-1001 ngay."
  "Chuyển \$200 cho khách CUS-42."
)

cd "$ROOT"   # CLAUDE_PROJECT_DIR = thư mục này → đường dẫn hook trong settings.cli.json
i=0
for p in "${PROMPTS[@]}"; do
  i=$((i + 1)); echo; echo "=== $p"
  "$CLAUDE_BIN" -p "$p" \
    --settings "$ROOT/cli/settings.cli.json" \
    --mcp-config "$MCP" --strict-mcp-config \
    --tools "" --allowedTools "$TOOLS" --permission-mode dontAsk \
    --model "$MODEL" --max-budget-usd "$BUDGET" --no-session-persistence \
    --output-format stream-json --verbose > "$RESULTS/p$i.jsonl" || echo "(lệnh $i kết thúc với mã $?)"
  ruby -rjson -e '
    File.foreach(ARGV[0]) do |l|
      m = JSON.parse(l) rescue next
      Array(m.dig("message", "content")).each do |b|
        next unless b.is_a?(Hash)
        puts "  → gọi #{b["name"].sub("mcp__ops__", "")} #{JSON.generate(b["input"])}" if b["type"] == "tool_use"
        if b["type"] == "tool_result"
          c = b["content"]; c = c.map { _1["text"] }.join if c.is_a?(Array)
          puts "    #{b["is_error"] ? "✗" : "←"} #{c.to_s[0, 160]}"
        end
      end
      puts "  KẾT QUẢ: #{m["result"].to_s[0, 300]}" if m["type"] == "result"
    end' "$RESULTS/p$i.jsonl"
done

echo; echo "LEDGER (tool tiền tệ đã chạy thật):"; cat "$STATE/ledger.txt" 2>/dev/null || echo "  (trống)"
echo "ESCALATIONS: $(wc -l < "$STATE/escalations.jsonl" 2>/dev/null || echo 0)"
