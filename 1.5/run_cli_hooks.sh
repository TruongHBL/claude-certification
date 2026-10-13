#!/usr/bin/env bash
# Bài 1.5 – biến thể THUẦN CLI: shell hook (cli/hooks/*.ts) + MCP server TypeScript (cli/ops_mcp_server.ts),
# chạy bằng `claude -p --settings cli/settings.cli.json`. Chỉ cần Node ≥ 22.6 (chạy .ts trực tiếp), không cần SDK, không cần API key.
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
TS=(node --experimental-strip-types --no-warnings)
H="$ROOT/cli/sh_helpers.ts"

if [ "${1:-}" = "clean" ]; then rm -rf "$STATE" "$RESULTS"; echo "đã xoá"; exit 0; fi

unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
"$CLAUDE_BIN" auth status 2>/dev/null | "${TS[@]}" "$H" logged-in \
  || { echo "Claude Code chưa đăng nhập. Chạy: claude  rồi gõ /login"; exit 1; }

rm -rf "$STATE" "$RESULTS"; mkdir -p "$STATE" "$RESULTS"
export HOOK_STATE_DIR="$STATE"              # hook là tiến trình riêng, kế thừa env của claude
MCP="$RESULTS/mcp.json"
"${TS[@]}" "$H" mcp-config "$ROOT/cli/ops_mcp_server.ts" "$STATE/ledger.txt" > "$MCP"

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
  "${TS[@]}" "$H" show "$RESULTS/p$i.jsonl"
done

echo; echo "LEDGER (tool tiền tệ đã chạy thật):"; cat "$STATE/ledger.txt" 2>/dev/null || echo "  (trống)"
echo "ESCALATIONS: $(wc -l < "$STATE/escalations.jsonl" 2>/dev/null || echo 0)"
