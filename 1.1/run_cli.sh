#!/usr/bin/env bash
# Bài 1.1 – bản CLI (không cần API key, dùng phiên đăng nhập claude.ai của `claude`).
#
# Claude Code TỰ chạy vòng lặp agent; mình chỉ cung cấp tool (MCP server loop_mcp_server.rb)
# rồi QUAN SÁT vòng lặp qua stream-json bằng parse_loop.rb.
#
# Dùng:  ./run_cli.sh ["câu hỏi"]        chạy 1 lần, lưu vào cli_runs/<thời điểm>/
#        ./run_cli.sh --parse <thư mục>   chỉ phân tích lại một lần chạy cũ
#
# Chi phí ước tính (haiku): 3–6 lượt API, ~15–30k token input/lượt (system prompt CLI + tool) ≈ 0,03–0,10 USD.
# Bị chặn trần bằng --max-budget-usd (mặc định 0.3).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL="${MODEL:-haiku}"
BUDGET="${BUDGET:-0.3}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
DEFAULT_Q="Tổng dân số Hà Nội và TP. Hồ Chí Minh năm 2024 là bao nhiêu? TP. Hồ Chí Minh đông hơn Hà Nội bao nhiêu phần trăm?"
SYSTEM="Bạn là trợ lý trả lời câu hỏi số liệu. Dùng web_search để lấy dữ kiện và calculator cho MỌI phép tính, không tự tính nhẩm. Trả lời ngắn gọn bằng tiếng Việt."

if [[ "${1:-}" == "--parse" ]]; then
  ruby "$ROOT/parse_loop.rb" "$2/loop.jsonl" "$2/tools.log"
  exit 0
fi

Q="${1:-$DEFAULT_Q}"
RUN="$ROOT/cli_runs/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUN"
ruby -rjson -e 'puts JSON.pretty_generate({ mcpServers: { loop: { type: "stdio", command: "ruby", args: [ARGV[0]],
                  env: { LOOP_LOG: ARGV[1] } } } })' "$ROOT/loop_mcp_server.rb" "$RUN/tools.log" > "$RUN/mcp.json"
printf '%s\n' "$Q" > "$RUN/question.txt"
echo "== Câu hỏi: $Q"
echo "== Lưu tại: $RUN"
# Chạy trong thư mục lần chạy (không có CLAUDE.md của project nào).
# --tools "" tắt tool built-in → chỉ còn 2 tool MCP, giống bản API chỉ có 2 tool.
(cd "$RUN" && "$CLAUDE_BIN" -p "$Q" \
  --model "$MODEL" \
  --system-prompt "$SYSTEM" \
  --mcp-config "$RUN/mcp.json" --strict-mcp-config \
  --tools "" \
  --allowedTools "mcp__loop__web_search" "mcp__loop__calculator" \
  --permission-mode dontAsk \
  --max-budget-usd "$BUDGET" \
  --no-session-persistence \
  --output-format stream-json --verbose \
  > "$RUN/loop.jsonl" 2> "$RUN/stderr.txt") || echo "(lệnh trả mã lỗi, xem $RUN/stderr.txt)"
ruby "$ROOT/parse_loop.rb" "$RUN/loop.jsonl" "$RUN/tools.log" | tee "$RUN/report.txt"
