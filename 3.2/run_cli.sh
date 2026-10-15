#!/usr/bin/env bash
# Bài 3.2 – kiểm chứng bằng Claude THẬT (chưa chạy; test dùng claude giả test/bin/claude).
#
#   ./run_cli.sh prepare   tạo 2 bản clone trong .tmp/ (mỗi bản `git init` riêng):
#                            clone/         y như demo-repo (analyse-feature có context: fork)
#                            clone-nofork/  giống hệt, chỉ bỏ dòng `context: fork` khỏi analyse-feature
#   ./run_cli.sh run       4 lệnh claude -p:
#                            list    trong clone/: đọc system:init → skills / slash_commands thấy được
#                                    (bước 1, 5: /review, /analyse-feature có; /lint không; /brainstorm chỉ khi
#                                    đã ./user_skill_demo.sh --apply)
#                            fork    trong clone/:        "/analyse-feature favorites"
#                            nofork  trong clone-nofork/: "/analyse-feature favorites"
#                            auto    trong clone/: hỏi bằng lời, không gõ /lệnh → Claude có tự chọn skill nhờ
#                                    description không
#   ./run_cli.sh report    so sánh: bao nhiêu nội dung tool (Read/Grep/Glob) đổ vào hội thoại CHÍNH
#                          (parent_tool_use_id = null) ở fork và nofork (bước 6: cô lập output)
#   ./run_cli.sh all       prepare + run + report
#   ./run_cli.sh clean
#
# Docs (code.claude.com/docs/en/headless): trong -p, "/skill-name" trong prompt được expand; skill có
# context: fork chạy bằng subagent, message của nó mang parent_tool_use_id bắt đầu bằng "forked-command-".
# KHÔNG dùng --safe-mode (tắt skills). Phiên nạp cả skill/plugin THẬT của máy; report chỉ xét 4 tên của bài.
# Chi phí ước tính: 4 lệnh haiku, list 1 lượt, 3 lệnh phân tích mỗi lệnh ~5–10 tool call trên 3 file nhỏ
#   ≈ 0,02–0,10 USD; mỗi lệnh chặn trần BUDGET.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="${TMP_DIR:-$ROOT/.tmp}"
RESULTS="${RESULTS_DIR:-$ROOT/results_cli}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
MODEL="${MODEL:-haiku}"
BUDGET="${BUDGET:-0.3}"
NODE="node --experimental-strip-types --no-warnings"
AUTO_PROMPT='Mình sắp sửa tính năng favorites. Hãy phân tích tính năng favorites giúp mình (luồng dữ liệu, file chính, rủi ro).'

prepare() {
  rm -rf "$TMP"; mkdir -p "$TMP"
  for d in clone clone-nofork; do
    cp -r "$ROOT/demo-repo" "$TMP/$d"
  done
  # Bản đối chứng: bỏ context: fork → skill chạy NGAY trong hội thoại chính.
  sed -i '/^context: fork$/d' "$TMP/clone-nofork/.claude/skills/analyse-feature/SKILL.md"
  for d in clone clone-nofork; do
    (cd "$TMP/$d" && git init -q && git add -A && git -c user.email=demo@example.com -c user.name=demo commit -qm init)
  done
  echo "Đã tạo $TMP/clone và $TMP/clone-nofork"
}

ask() { # ask <thư mục clone> <tên output> <prompt> [cờ thêm…]
  local dir="$1" name="$2" prompt="$3"; shift 3
  mkdir -p "$RESULTS"
  echo "▶ $name (cwd=$dir)"
  (cd "$TMP/$dir" && "$CLAUDE_BIN" -p "$prompt" --model "$MODEL" --max-budget-usd "$BUDGET" \
     --no-session-persistence --output-format stream-json --verbose "$@" \
     > "$RESULTS/$name.jsonl" 2> "$RESULTS/$name.err") || echo "  (mã lỗi, xem $RESULTS/$name.err)"
}

run() {
  [[ -d "$TMP/clone" ]] || prepare
  mkdir -p "$RESULTS"
  "$ROOT/user_skill_demo.sh" --status > "$RESULTS/personal_status.txt" 2>&1 || true
  local tools=(--tools "Read,Grep,Glob,Skill,Agent" --allowedTools "Read,Grep,Glob" --permission-mode dontAsk)
  ask clone list 'Trả lời đúng một chữ: OK' --tools ""
  ask clone fork '/analyse-feature favorites' "${tools[@]}"
  ask clone-nofork nofork '/analyse-feature favorites' "${tools[@]}"
  ask clone auto "$AUTO_PROMPT" "${tools[@]}"
}

case "${1:-}" in
  prepare) prepare ;;
  run) run ;;
  report) $NODE "$ROOT/report_cli.ts" "$RESULTS" ;;
  all) prepare; run; $NODE "$ROOT/report_cli.ts" "$RESULTS" ;;
  clean) rm -rf "$TMP" "$RESULTS" ;;
  *) sed -n '2,24p' "$0"; exit 1 ;;
esac
