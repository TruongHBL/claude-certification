#!/usr/bin/env bash
# Bài 2.3 – bản chạy bằng Claude Code CLI (dùng phiên đăng nhập claude.ai của máy, KHÔNG cần API key).
#
#   ./run_cli.sh run      # coordinator + 3 subagent, cấu hình đúng            → logs/cli/run/
#   ./run_cli.sh misuse   # CỐ Ý cấp nhầm search_web cho synthesis → hook chặn  → logs/cli/misuse/
#   ./run_cli.sh audit [run|misuse]   # chấm lại từ log có sẵn
#   ./run_cli.sh clean
#
# Mỗi lần run/misuse = MỘT lệnh `claude -p` (coordinator gọi subagent bằng tool Agent).
# Model mặc định haiku (CLI_MODEL=sonnet để đổi). Trần chi phí mỗi lệnh: MAX_BUDGET (mặc định 1.5 USD).
# Ước tính: 0,3–1 USD mỗi lệnh (Claude Code gửi system prompt + định nghĩa tool lớn ở mọi lượt của mọi agent).
#
# Khác bản Messages API (multi_agent_run.ts --real):
#   tool_choice forced/any  → KHÔNG có trong CLI. Thay bằng hook PreToolUse CHẶN tool khác của doc-analysis
#                             tới khi extract_metadata được gọi (chặn, không ép).
#   allowlist + audit       → agents.json "tools" (lớp 1) + hook PreToolUse deny + log (lớp 2).
#   tool chạy local         → MCP server stdio cli/research_mcp_server.ts (cùng dữ liệu giả).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
MAX_BUDGET="${MAX_BUDGET:-1.5}"
TS=(node --experimental-strip-types --no-warnings)

run_one() {
  local mode="$1" out="$ROOT/logs/cli/$1"
  rm -rf "$out"
  local extra=()
  [[ "$mode" == "misuse" ]] && extra=(--misuse)
  "${TS[@]}" "$ROOT/cli/cli_config.ts" "$out" ${extra[@]+"${extra[@]}"} >/dev/null

  echo "== $mode: chạy $CLAUDE_BIN -p (model ${CLI_MODEL:-haiku}, trần $MAX_BUDGET USD) =="
  # --setting-sources project: không nạp settings của user (hook SessionStart, plugin) để log sạch;
  #   hook của bài vẫn có qua --settings. CLAUDE.md của user vẫn có thể được nạp ở luồng chính
  #   (subagent đã đặt omitClaudeMd).
  # --tools Agent: bộ tool built-in chỉ còn Agent (không Bash/Read/WebSearch…).
  # --agent coordinator: luồng chính chạy theo định nghĩa coordinator → chỉ thấy tools của coordinator.
  (cd "$out" && "$CLAUDE_BIN" -p "$(cat question.txt)" \
      --agent coordinator \
      --agents "$out/agents.json" \
      --mcp-config "$out/mcp.json" --strict-mcp-config \
      --settings "$out/settings.json" \
      --setting-sources project \
      --tools Agent \
      --allowedTools "$(cat allowed_tools.txt)" \
      --permission-mode dontAsk \
      --model "${CLI_MODEL:-haiku}" \
      --max-budget-usd "$MAX_BUDGET" \
      --no-session-persistence \
      --output-format stream-json --verbose \
      > "$out/stream.jsonl" 2> "$out/stderr.txt") || echo "(claude thoát mã $? — xem $out/stderr.txt)"
  "${TS[@]}" "$ROOT/audit_cli.ts" "$out" ${extra[@]+"${extra[@]}"}
}

case "${1:-}" in
  run|misuse) run_one "$1" ;;
  audit) "${TS[@]}" "$ROOT/audit_cli.ts" "$ROOT/logs/cli/${2:-run}" $([[ "${2:-run}" == misuse ]] && echo --misuse) ;;
  clean) rm -rf "$ROOT/logs/cli" ;;
  *) sed -n '2,9p' "$0"; exit 1 ;;
esac
