#!/usr/bin/env bash
# Bài 2.5 – để Claude Code (CLI thật) tự lần theo và refactor hàm deprecated, rồi chấm chuỗi tool nó đã chọn.
#
# Dùng:  ./run_cli.sh reset     copy sample/ → .work/ (bản gốc không bao giờ bị sửa)
#        ./run_cli.sh run       claude -p trong .work/, ghi results/run.jsonl
#        ./run_cli.sh analyze   in chuỗi tool + chấm tiêu chí (Grep trước, Glob tìm test, Edit, non-unique…)
#        ./run_cli.sh verify    chạy test của codebase trong .work/ + kiểm không còn lời gọi deprecated
#        ./run_cli.sh all       reset → run → analyze → verify
#        ./run_cli.sh clean
#
# Biến môi trường:
#   MODEL (mặc định sonnet) · BUDGET (USD, mặc định 1) · CLAUDE_BIN (mặc định claude)
#   ALLOW_WRITE=1  cho phép thêm tool Write (mặc định KHÔNG: buộc sửa bằng Edit, quan sát cách xử lý non-unique)
#   SEARCH=bash    nếu bản Claude Code không có Grep/Glob riêng: cho Bash nhưng chỉ lệnh grep/rg/find (read-only)
#   WORK_DIR, OUT_DIR  (test dùng thư mục tạm)
# Chi phí ước tính: sonnet, ~15–25 lượt tool → khoảng 0,1–0,5 USD; bị chặn trần bằng --max-budget-usd.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${WORK_DIR:-$ROOT/.work}"
OUT="${OUT_DIR:-$ROOT/results}"
MODEL="${MODEL:-sonnet}"
BUDGET="${BUDGET:-1}"
CLAUDE="${CLAUDE_BIN:-claude}"
TS=(node --experimental-strip-types --no-warnings)

# Prompt KHÔNG gợi ý tool nào: để quan sát Claude tự chọn Grep/Glob/Read/Edit.
PROMPT="Hàm processLegacyOrder(orderId) trong src/orders/legacy.ts đã deprecated. \
Hãy chuyển MỌI nơi đang dùng nó sang API mới processOrder(orderId, { validate: true }) trong src/orders/process.ts, \
kể cả những nơi dùng gián tiếp (qua hàm bọc hoặc qua tên khác do re-export). \
Giữ nguyên src/orders/legacy.ts và test của chính nó. \
Cuối cùng liệt kê các file đã sửa và các file test liên quan tới những chỗ đã sửa."

cmd_reset() {
  rm -rf "$WORK"
  mkdir -p "$(dirname "$WORK")"
  cp -r "$ROOT/sample" "$WORK"
  echo "Đã tạo $WORK từ sample/ ($(find "$WORK" -type f | wc -l) file)"
}

cmd_run() {
  [[ -d "$WORK" ]] || cmd_reset
  mkdir -p "$OUT"
  local tools=(Read Grep Glob Edit) allow
  [[ "${SEARCH:-}" == bash ]] && tools=(Read Edit Bash)
  [[ "${ALLOW_WRITE:-0}" == 1 ]] && tools+=(Write)
  local IFS=,
  allow=("${tools[@]}")
  # Bash (nếu bật) chỉ được chạy lệnh tìm kiếm read-only.
  [[ "${SEARCH:-}" == bash ]] && allow=(Read Edit "Bash(grep:*)" "Bash(rg:*)" "Bash(find:*)" "Bash(ls:*)") && [[ "${ALLOW_WRITE:-0}" == 1 ]] && allow+=(Write)
  echo "▶ claude -p (model=$MODEL, tools=${tools[*]}) trong $WORK"
  (cd "$WORK" && "$CLAUDE" -p "$PROMPT" \
    --model "$MODEL" \
    --tools "${tools[*]}" \
    --allowedTools "${allow[@]}" \
    --permission-mode dontAsk \
    --safe-mode \
    --max-budget-usd "$BUDGET" \
    --no-session-persistence \
    --output-format stream-json --verbose \
    > "$OUT/run.jsonl" 2> "$OUT/run.err") || echo "  (claude trả mã lỗi, xem $OUT/run.err)"
  echo "  → $OUT/run.jsonl ($(wc -l < "$OUT/run.jsonl") event)"
}

cmd_analyze() { "${TS[@]}" "$ROOT/analyze_tools.ts" "$OUT/run.jsonl" "$WORK"; }
cmd_verify()  { "${TS[@]}" "$ROOT/verify.ts" "$WORK"; }

case "${1:-}" in
  reset|run|verify) "cmd_$1" ;;
  analyze) cmd_analyze || true ;;
  all) cmd_reset; cmd_run; cmd_analyze || true; echo; cmd_verify ;;
  clean) rm -rf "$WORK" "$OUT" ;;
  *) sed -n '2,19p' "$0"; exit 1 ;;
esac
