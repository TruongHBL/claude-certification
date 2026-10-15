#!/usr/bin/env bash
# Bài 3.1 – kiểm chứng bằng Claude THẬT: mỗi file hướng dẫn trong demo-repo chứa một mã CANARY riêng;
# hỏi Claude in mọi CANARY nó thấy, từ đó biết file nào đã được nạp ở từng thư mục.
#
#   ./run_cli.sh prepare     tạo 2 bản clone trong .tmp/ (mỗi bản `git init` riêng để thành project độc lập):
#                              me/        có CLAUDE.local.md (copy từ .example), như máy của mình
#                              newcomer/  không có CLAUDE.local.md, như người mới clone (file đó bị gitignore)
#   ./run_cli.sh run         3 vị trí (., packages/api, packages/web) × 2 phiên + 1 lần on-demand = 7 lệnh claude -p
#   ./run_cli.sh report      so CANARY thấy được với mô hình expected_loading.ts
#   ./run_cli.sh all         prepare + run + report
#   ./run_cli.sh clean
#
# Phiên "newcomer" chạy với --setting-sources project,local để BỎ user-level. CHƯA KIỂM CHỨNG cờ này có bỏ
# ~/.claude/CLAUDE.md hay không (tài liệu chỉ nói nó bỏ settings/rules/CLAUDE.local.md theo nguồn); report_cli.ts
# sẽ cho biết. USER_CLAUDE_MD (mặc định ~/.claude/CLAUDE.md, chỉ đọc) là file report dùng để biết khối demo có hay không.
# Muốn thấy CANARY-USER-3H ở phiên "me" thì chạy ./user_level_demo.sh --apply trước (và --revert sau).
#
# KHÔNG dùng --safe-mode: cờ đó tắt luôn CLAUDE.md. Phiên "me" nạp ~/.claude/CLAUDE.md THẬT của máy;
# report chỉ xét các mã CANARY-*, phần còn lại của file đó không ảnh hưởng.
# Chi phí ước tính: 7 lệnh haiku, mỗi lệnh 1 lượt (on-demand 2–3 lượt) ≈ 0,01–0,05 USD; mỗi lệnh chặn trần BUDGET.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="${TMP_DIR:-$ROOT/.tmp}"
RESULTS="${RESULTS_DIR:-$ROOT/results_cli}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
MODEL="${MODEL:-haiku}"
BUDGET="${BUDGET:-0.05}"
NODE="node --experimental-strip-types --no-warnings"
PROMPT='Không dùng tool. Hãy rà toàn bộ hướng dẫn và bộ nhớ dự án (CLAUDE.md, rules, file được import) đã được nạp cho bạn trong phiên này và liệt kê MỌI chuỗi có dạng CANARY-…, mỗi dòng một chuỗi, giữ nguyên chữ. Nếu không thấy chuỗi nào, trả lời đúng một chữ: NONE.'
ONDEMAND_PROMPT='Đọc file packages/api/src/routes.ts bằng tool Read. Sau đó liệt kê MỌI chuỗi có dạng CANARY-… trong hướng dẫn và bộ nhớ dự án mà bạn đang có (kể cả phần được nạp thêm sau khi đọc file), mỗi dòng một chuỗi. Không thấy thì trả lời NONE.'

prepare() {
  rm -rf "$TMP"; mkdir -p "$TMP"
  for who in me newcomer; do
    cp -r "$ROOT/demo-repo" "$TMP/$who"
    (cd "$TMP/$who" && git init -q && git add -A && git -c user.email=demo@example.com -c user.name=demo commit -qm init)
  done
  cp "$ROOT/demo-repo/CLAUDE.local.md.example" "$TMP/me/CLAUDE.local.md"
  echo "Đã tạo $TMP/me (có CLAUDE.local.md) và $TMP/newcomer (không có)"
}

ask() { # ask <who> <cwd tương đối> <tên output> <prompt> [cờ thêm…]
  local who="$1" rel="$2" name="$3" prompt="$4"; shift 4
  local extra=()
  [[ "$who" == newcomer ]] && extra+=(--setting-sources project,local)
  mkdir -p "$RESULTS/$who"
  echo "▶ $who · cwd=$rel · $name"
  (cd "$TMP/$who/$rel" && "$CLAUDE_BIN" -p "$prompt" --model "$MODEL" --max-budget-usd "$BUDGET" \
     --no-session-persistence --output-format stream-json --verbose "${extra[@]}" "$@" \
     > "$RESULTS/$who/$name.jsonl" 2> "$RESULTS/$who/$name.err") || echo "  (mã lỗi, xem $RESULTS/$who/$name.err)"
}

run() {
  [[ -d "$TMP/me" ]] || prepare
  for who in me newcomer; do
    ask "$who" . root "$PROMPT" --tools ""
    ask "$who" packages/api api "$PROMPT" --tools ""
    ask "$who" packages/web web "$PROMPT" --tools ""
  done
  # On-demand: đứng ở gốc, cho Claude đọc một file trong packages/api → CLAUDE.md của thư mục đó mới nạp.
  ask newcomer . root-ondemand "$ONDEMAND_PROMPT" --tools Read --allowedTools Read --permission-mode dontAsk
}

case "${1:-}" in
  prepare) prepare ;;
  run) run ;;
  report) $NODE "$ROOT/report_cli.ts" "$RESULTS" "$TMP" "${USER_CLAUDE_MD:-}" ;;
  all) prepare; run; $NODE "$ROOT/report_cli.ts" "$RESULTS" "$TMP" "${USER_CLAUDE_MD:-}" ;;
  clean) rm -rf "$TMP" "$RESULTS" ;;
  *) sed -n '2,20p' "$0"; exit 1 ;;
esac
