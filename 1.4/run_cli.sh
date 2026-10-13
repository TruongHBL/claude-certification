#!/usr/bin/env bash
# Bài 1.4 – bản chạy bằng Claude Code CLI (dùng phiên đăng nhập claude.ai, KHÔNG cần API key).
#
# 4 tool chạy trong MCP server support_mcp_server.ts; cổng chặn process_refund nằm trong code server.
# Mỗi kịch bản = một lệnh `claude -p` = một phiên, có file state + log riêng trong results_cli/.
#
# Dùng:  ./run_cli.sh normal | skip | wrongphone | multi | all
#        ./run_cli.sh score     chấm lại từ results_cli/
#        ./run_cli.sh clean     xoá results_cli/
#
# Chi phí ước tính (haiku): mỗi kịch bản 3–8 lượt model, ~15–30k token input/lượt (system prompt CLI
# + 4 schema tool) → 4 kịch bản ≈ 0,2–0,6 USD. Mỗi lệnh bị chặn trần bằng --max-budget-usd.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS="$ROOT/results_cli"
MODEL="${MODEL:-haiku}"
BUDGET="${BUDGET:-0.3}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
NODE_BIN="$(command -v node)"
TS=("$NODE_BIN" --experimental-strip-types --no-warnings)
TOOLS=(mcp__support__get_customer mcp__support__lookup_order mcp__support__process_refund mcp__support__escalate_to_human)

scenario_text() {
  "$NODE_BIN" -e 'const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).scenarios.find((x) => x.id === process.argv[2]);
                  if (!s) { console.error("Không có kịch bản " + process.argv[2]); process.exit(1); }
                  console.log(s.text);' "$ROOT/scenarios.json" "$1"
}

run_one() {
  local id="$1" dir="$RESULTS/$1" text
  text="$(scenario_text "$id")"
  rm -rf "$dir"; mkdir -p "$dir"
  "$NODE_BIN" -e 'const [node, srv, state, log] = process.argv.slice(1);
                  console.log(JSON.stringify({ mcpServers: { support: { type: "stdio", command: node,
                    args: ["--experimental-strip-types", "--no-warnings", srv],
                    env: { STATE_FILE: state, SUPPORT_LOG: log } } } }, null, 2));' \
    "$NODE_BIN" "$ROOT/support_mcp_server.ts" "$dir/state.json" "$dir/tools.log" > "$dir/mcp.json"
  echo "== $id: $text"
  # Chạy trong thư mục rỗng để không nạp CLAUDE.md/settings của project nào.
  # --tools "" tắt tool built-in (Bash, Read…): agent chỉ có 4 tool MCP, giống bản API.
  (cd "$RESULTS" && "$CLAUDE_BIN" -p "$text" \
    --model "$MODEL" \
    --system-prompt "$(cat "$ROOT/system_prompt.txt")" \
    --mcp-config "$dir/mcp.json" --strict-mcp-config \
    --tools "" \
    --allowedTools "${TOOLS[@]}" \
    --permission-mode dontAsk \
    --max-budget-usd "$BUDGET" \
    --no-session-persistence \
    --output-format stream-json --verbose \
    > "$dir/stream.jsonl" 2> "$dir/stderr.txt") || echo "   (lệnh trả mã lỗi, xem $dir/stderr.txt)"
}

score() { "${TS[@]}" "$ROOT/score_cli.ts" "$RESULTS" "$ROOT/scenarios.json" "$@"; }

case "${1:-}" in
  normal|skip|wrongphone|multi) run_one "$1"; score "$1" ;;
  all)   for s in normal skip wrongphone multi; do run_one "$s"; done; score ;;
  score) score ;;
  clean) rm -rf "$RESULTS" ;;
  *) echo "Dùng: $0 normal|skip|wrongphone|multi|all|score|clean"; exit 1 ;;
esac
