#!/usr/bin/env bash
# Bài 1.6 – bản chạy bằng Claude Code CLI (phiên đăng nhập claude.ai, KHÔNG cần API key).
#
# Dùng:  ./run_cli.sh single     1 lệnh `claude -p` cho cả 12 file
#        ./run_cli.sh multi      12 lệnh per-file (song song tối đa 4, xargs -P 4) + 1 lệnh integration
#        ./run_cli.sh compare    chấm với bai_1_6_sample/ANSWER_KEY.json (bộ chấm của bản API)
#        ./run_cli.sh all        single → multi → compare
#        ./run_cli.sh clean      xoá bai_1_6_results_cli/
#
# Chi phí ước tính (haiku): 14 lệnh; mỗi lệnh ~15–25k token input (system prompt CLI + code/tóm tắt)
# và 1–3k token output → khoảng 0,2–0,6 USD tổng. Mỗi lệnh bị chặn trần bằng --max-budget-usd (BUDGET).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARALLEL="${PARALLEL:-4}"
TS=(node --experimental-strip-types --no-warnings)
CLI="$ROOT/review_cli.ts"
mkdir -p "$ROOT/bai_1_6_results_cli"

run_single() { echo "== single-pass"; "${TS[@]}" "$CLI" single; }
run_multi() {
  echo "== multi-pass: per-file (song song $PARALLEL)"
  "${TS[@]}" "$CLI" list | xargs -P "$PARALLEL" -I{} "${TS[@]}" "$CLI" file {}
  echo "== multi-pass: integration (chỉ summary/exports/imports)"
  "${TS[@]}" "$CLI" integrate
}
run_compare() { echo "== compare"; "${TS[@]}" "$CLI" compare; }

case "${1:-}" in
  single)  run_single ;;
  multi)   run_multi ;;
  compare) run_compare ;;
  all)     run_single; run_multi; run_compare ;;
  clean)   rm -rf "$ROOT/bai_1_6_results_cli" ;;
  *) echo "Dùng: $0 single|multi|compare|all|clean"; exit 1 ;;
esac
