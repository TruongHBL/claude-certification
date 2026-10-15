#!/usr/bin/env bash
# Bài 3.3 – kiểm chứng bằng Claude THẬT: rule có `paths` chỉ được nạp khi Claude đọc một file khớp.
# Mỗi rule trong demo-repo chứa một mã CANARY riêng; mỗi lệnh bắt Claude Read đúng MỘT file rồi in mọi CANARY
# nó thấy → biết rule nào đã vào context. Chạy trên 2 biến thể để so (bước 6):
#   rules/  = demo-repo (quy ước tách thành .claude/rules/ có paths)
#   root/   = variant-root (mọi quy ước gom vào root CLAUDE.md, sinh bởi make_variant.ts)
#
#   ./run_cli.sh prepare   tạo .tmp/rules và .tmp/root (mỗi bản `git init` riêng để thành project độc lập)
#   ./run_cli.sh run       2 biến thể × 5 ca (none, test, api, terraform, utils) = 10 lệnh claude -p
#   ./run_cli.sh report    so CANARY thấy được với match_rules.ts, in input token của từng lệnh
#   ./run_cli.sh all       prepare + run + report
#   ./run_cli.sh clean
#
# Ca "none" không cho tool nào: chỉ thấy phần nạp lúc khởi động (root CLAUDE.md + rule không có paths).
# Cờ: --tools Read (chỉ Read), --allowedTools Read, --permission-mode dontAsk, --no-session-persistence.
# KHÔNG dùng --safe-mode (nó tắt CLAUDE.md và rules). ~/.claude/CLAUDE.md thật của máy vẫn được nạp;
# report chỉ xét các mã CANARY-*.
# Chi phí ước tính: 10 lệnh haiku, mỗi lệnh 1–2 lượt ≈ 0,01–0,05 USD; mỗi lệnh chặn trần BUDGET.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="${TMP_DIR:-$ROOT/.tmp}"
RESULTS="${RESULTS_DIR:-$ROOT/results_cli}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
MODEL="${MODEL:-haiku}"
BUDGET="${BUDGET:-0.05}"
NODE="node --experimental-strip-types --no-warnings"

CASES=(none:- test:src/auth/auth.test.ts api:src/api/customers.ts terraform:terraform/main.tf utils:src/utils/format.ts)
LIST='liệt kê MỌI chuỗi có dạng CANARY-… nằm trong hướng dẫn dự án (CLAUDE.md, rules) mà bạn đang có trong phiên này, kể cả phần được nạp thêm sau khi đọc file, mỗi dòng một chuỗi, giữ nguyên chữ. Không thấy chuỗi nào thì trả lời đúng một chữ: NONE.'

prepare() {
  rm -rf "$TMP"; mkdir -p "$TMP"
  cp -r "$ROOT/demo-repo" "$TMP/rules"
  $NODE "$ROOT/make_variant.ts" "$ROOT/demo-repo" "$TMP/root" > /dev/null
  for v in rules root; do
    (cd "$TMP/$v" && git init -q && git add -A && git -c user.email=demo@example.com -c user.name=demo commit -qm init)
  done
  echo "Đã tạo $TMP/rules (rules theo path) và $TMP/root (gom vào root CLAUDE.md)"
}

run() {
  [[ -d "$TMP/rules" ]] || prepare
  for v in rules root; do
    mkdir -p "$RESULTS/$v"
    for c in "${CASES[@]}"; do
      local name="${c%%:*}" file="${c#*:}" prompt tools=()
      if [[ "$file" == "-" ]]; then
        prompt="Không dùng tool. Hãy $LIST"; tools=(--tools "")
      else
        prompt="Dùng tool Read đọc file $file (chỉ file này). Sau đó $LIST"; tools=(--tools Read --allowedTools Read)
      fi
      echo "▶ $v · $name ${file/-/}"
      (cd "$TMP/$v" && "$CLAUDE_BIN" -p "$prompt" --model "$MODEL" --max-budget-usd "$BUDGET" \
         --permission-mode dontAsk --no-session-persistence --output-format stream-json --verbose "${tools[@]}" \
         > "$RESULTS/$v/$name.jsonl" 2> "$RESULTS/$v/$name.err") || echo "  (mã lỗi, xem $RESULTS/$v/$name.err)"
    done
  done
}

report() { $NODE "$ROOT/report_cli.ts" "$RESULTS" "$TMP"; }

case "${1:-}" in
  prepare) prepare ;;
  run) run ;;
  report) report ;;
  all) prepare; run; report ;;
  clean) rm -rf "$TMP" "$RESULTS" ;;
  *) sed -n '2,19p' "$0"; exit 1 ;;
esac
