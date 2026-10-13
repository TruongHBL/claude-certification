#!/usr/bin/env bash
# Bài 1.2 – bản CLI (không cần API key, dùng phiên đăng nhập claude.ai của `claude`).
#
# Hub-and-spoke bằng chính cơ chế subagent của Claude Code:
#   - coordinator = phiên chính (--system-prompt coordinator_prompt.txt), chỉ có tool Agent
#   - 3 subagent khai báo bằng --agents agents.json: search-agent (chỉ có tool search),
#     analysis-agent và synthesis-agent (không có tool nào, không spawn được ai)
#   - tool search GIẢ LẬP qua MCP server research_mcp_server.rb
# Sau khi chạy, parse_hub.rb kiểm tra: subagent chỉ do coordinator spawn, subagent không gọi nhau,
# search chỉ chạy trong search-agent, và liệt kê prompt giao việc.
#
# Dùng:  ./run_cli.sh ["chủ đề"]          chạy 1 lần, lưu vào cli_runs/<thời điểm>/
#        ./run_cli.sh --parse <thư mục>   chỉ phân tích lại một lần chạy cũ
#
# Chi phí ước tính (haiku cho cả coordinator và subagent): ~16 phiên agent (1 coordinator + 5 search
# + 5 analysis + 0–4 bổ sung + 1 synthesis), mỗi phiên vài lượt × 10–25k token ≈ 0,3–1,0 USD.
# Bị chặn trần bằng --max-budget-usd (mặc định 1.5).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL="${MODEL:-haiku}"
BUDGET="${BUDGET:-1.5}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

if [[ "${1:-}" == "--parse" ]]; then
  ruby "$ROOT/parse_hub.rb" "$2/hub.jsonl" "$2/tools.log"
  exit 0
fi

TOPIC="${1:-Renewable energy technologies}"
RUN="$ROOT/cli_runs/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUN"
ruby -rjson -e 'puts JSON.pretty_generate({ mcpServers: { research: { type: "stdio", command: "ruby", args: [ARGV[0]],
                  env: { RESEARCH_LOG: ARGV[1] } } } })' "$ROOT/research_mcp_server.rb" "$RUN/tools.log" > "$RUN/mcp.json"
cp "$ROOT/agents.json" "$RUN/agents.json"
echo "== Chủ đề: $TOPIC"
echo "== Lưu tại: $RUN"
# --tools "Agent": trong bộ tool built-in chỉ giữ Agent (để coordinator spawn subagent).
# Tool search đến từ MCP; search-agent được cấp qua trường "tools" trong agents.json.
(cd "$RUN" && "$CLAUDE_BIN" -p "Chủ đề nghiên cứu: $TOPIC" \
  --model "$MODEL" \
  --system-prompt "$(cat "$ROOT/coordinator_prompt.txt")" \
  --agents "$RUN/agents.json" \
  --mcp-config "$RUN/mcp.json" --strict-mcp-config \
  --tools "Agent" \
  --allowedTools "Agent" "mcp__research__search" \
  --permission-mode dontAsk \
  --max-budget-usd "$BUDGET" \
  --no-session-persistence \
  --output-format stream-json --verbose \
  > "$RUN/hub.jsonl" 2> "$RUN/stderr.txt") || echo "(lệnh trả mã lỗi, xem $RUN/stderr.txt)"
ruby "$ROOT/parse_hub.rb" "$RUN/hub.jsonl" "$RUN/tools.log" | tee "$RUN/report.txt"
