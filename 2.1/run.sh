#!/usr/bin/env bash
# Bài 2.1 – chạy 10 query qua Claude Code CLI với 3 cấu hình rồi chấm tool được gọi ĐẦU TIÊN.
#
#   A = mô tả vague + system prompt conflict   (tình trạng ban đầu)
#   B = mô tả clear + system prompt conflict   (chỉ sửa mô tả)
#   C = mô tả clear + system prompt fixed      (sửa cả mô tả lẫn system prompt)
#
# Dùng:  ./run.sh A | B | C | all     chạy (MỖI query một lệnh `claude -p` riêng, không chung context)
#        ./run.sh score               in bảng độ chính xác + danh sách câu sai
#        ./run.sh clean               xoá results/
#
# Chi phí ước tính (haiku): ~10–20k token input mỗi lệnh (system prompt CLI + mô tả tool), 1–2 lượt.
# 30 lệnh ≈ 0,3–0,8 USD. Mỗi lệnh bị chặn trần bằng --max-budget-usd.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS="${RESULTS_DIR:-$ROOT/results}"   # test đặt RESULTS_DIR riêng để không ghi đè kết quả thật
NODE="${NODE_BIN:-node}"
TS=(--experimental-strip-types --no-warnings)
MODEL="${MODEL:-haiku}"
BUDGET="${BUDGET:-0.2}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

toolset_of() { case "$1" in A) echo vague ;; B|C) echo clear ;; esac; }
prompt_of()  { case "$1" in A|B) echo "$ROOT/prompts/system_conflict.txt" ;; C) echo "$ROOT/prompts/system_fixed.txt" ;; esac; }

run_config() {
  local cfg="$1" toolset prompt dir n
  toolset="$(toolset_of "$cfg")"; prompt="$(prompt_of "$cfg")"
  dir="$RESULTS/$cfg"; mkdir -p "$dir"
  n="$("$NODE" -e 'console.log(require(process.argv[1]).queries.length)' "$ROOT/queries.json")"
  echo "== Cấu hình $cfg: TOOLSET=$toolset, prompt=$(basename "$prompt"), model=$MODEL"
  for ((i = 0; i < n; i++)); do
    local id text mcp
    id="$("$NODE" -e 'console.log(require(process.argv[1]).queries[+process.argv[2]].id)' "$ROOT/queries.json" "$i")"
    text="$("$NODE" -e 'console.log(require(process.argv[1]).queries[+process.argv[2]].text)' "$ROOT/queries.json" "$i")"
    mcp="$dir/q$id.mcp.json"
    rm -f "$dir/q$id.log"
    # Mỗi query một file cấu hình MCP để log tool call tách riêng theo query.
    # Server chạy bằng node (đường dẫn tuyệt đối) với --experimental-strip-types.
    "$NODE" -e 'const [srv, toolset, log, node] = process.argv.slice(1);
      console.log(JSON.stringify({ mcpServers: { shop: { type: "stdio", command: node,
        args: ["--experimental-strip-types", "--no-warnings", srv], env: { TOOLSET: toolset, SHOP_LOG: log } } } }, null, 2))' \
      "$ROOT/shop_mcp_server.ts" "$toolset" "$dir/q$id.log" "$(command -v "$NODE")" > "$mcp"
    echo "  q$id: $text"
    # Chạy trong thư mục rỗng để không nạp CLAUDE.md/settings của project nào.
    (cd "$RESULTS" && "$CLAUDE_BIN" -p "$text" \
      --model "$MODEL" \
      --system-prompt "$(cat "$prompt")" \
      --mcp-config "$mcp" --strict-mcp-config \
      --tools "" \
      --allowedTools "mcp__shop__get_customer" "mcp__shop__lookup_order" \
      --permission-mode dontAsk \
      --max-budget-usd "$BUDGET" \
      --no-session-persistence \
      --output-format stream-json --verbose \
      > "$dir/q$id.jsonl" 2> "$dir/q$id.err") || echo "    (lệnh trả mã lỗi, xem $dir/q$id.err)"
  done
}

case "${1:-}" in
  A|B|C) run_config "$1" ;;
  all)   for c in A B C; do run_config "$c"; done; "$NODE" "${TS[@]}" "$ROOT/score.ts" "$RESULTS" "$ROOT/queries.json" ;;
  score) "$NODE" "${TS[@]}" "$ROOT/score.ts" "$RESULTS" "$ROOT/queries.json" ;;
  clean) rm -rf "$RESULTS" ;;
  *) echo "Dùng: $0 A|B|C|all|score|clean"; exit 1 ;;
esac
