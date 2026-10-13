#!/usr/bin/env bash
# Bài 1.7: Session management (resume / fork / fresh start + summary) với Claude Code CLI.
#
# Cách dùng:  ./run.sh <lệnh>
#   reset    Tạo lại work/ từ codebase/ (bản gốc không bao giờ bị sửa), xoá out/ và .session_id
#   step1    Phiên có tên "cca-1-7-review": review 10 file
#   step2    Resume phiên đó: viết summary có cấu trúc → out/summary.md
#   step3    Copy fixes/ đè 3 file (auth, session, middleware) trong work/
#   step4    Resume phiên cũ sau khi file đã đổi → quan sát stale context
#   step5    Phiên MỚI: inject summary + danh sách 3 file đã đổi → chỉ phân tích lại 3 file
#   step6    (bonus) --resume --fork-session: rẽ nhánh, phiên gốc không bị thay đổi
#   compare  So sánh step4 và step5 theo ANSWER_KEY.md (grep dấu hiệu stale + file đã Read)
#   all      reset → step1 … step5 → compare
#
# Chi phí: mỗi lệnh claude bị chặn bởi --max-budget-usd (mặc định 1 USD, đổi bằng BUDGET_USD).
#   10 file nhỏ với sonnet: ước lượng ~0.05–0.3 USD/bước, cả bài thường dưới 1–2 USD
#   (nếu đăng nhập bằng gói Pro/Max thì trừ vào hạn mức của gói thay vì tiền).
# Dừng: Ctrl+C bất cứ lúc nào; mỗi bước độc lập, chạy lại bước nào cũng được.
# Biến môi trường: MODEL (mặc định sonnet), BUDGET_USD, SAFE_MODE=0 để tắt --safe-mode,
#   CLAUDE_BIN (mặc định claude), CLAUDE_PROJECTS_DIR (mặc định ~/.claude/projects).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$ROOT/work"
OUT="$ROOT/out"
SID_FILE="$ROOT/.session_id"
CLAUDE="${CLAUDE_BIN:-claude}"
MODEL="${MODEL:-sonnet}"
BUDGET="${BUDGET_USD:-1}"
PROJECTS_DIR="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"
NAME="cca-1-7-review"
# Đọc JSON output / transcript bằng helper TypeScript lib.ts (cần Node ≥ 22.6)
ts() { node --experimental-strip-types --no-warnings "$ROOT/lib.ts" "$@"; }
CHANGED=(auth.rb session.rb middleware.rb)

# Cờ chung: chạy không tương tác, output JSON, chỉ cho đọc file.
# --safe-mode tắt CLAUDE.md/plugin/hook của máy để thí nghiệm sạch và rẻ.
common_flags() {
  local f=(-p --output-format json --model "$MODEL" --max-budget-usd "$BUDGET"
           --allowedTools "Read,Grep,Glob" --permission-mode dontAsk)
  [[ "${SAFE_MODE:-1}" == 1 ]] && f+=(--safe-mode)
  printf '%s\n' "${f[@]}"
}

# ask <tên-output> <prompt> [cờ thêm...]  — luôn chạy trong work/ (phiên gắn với thư mục)
ask() {
  local out="$1" prompt="$2"; shift 2
  local flags; mapfile -t flags < <(common_flags)
  mkdir -p "$OUT"
  echo "▶ $out: $CLAUDE ${flags[*]} $* -- \"<prompt>\""
  (cd "$WORK" && "$CLAUDE" "${flags[@]}" "$@" -- "$prompt") > "$OUT/$out.json"
  ts result "$OUT/$out.json" "$OUT/$out.md"
}

need_session() {
  [[ -s "$SID_FILE" ]] || { echo "Chưa có phiên: chạy ./run.sh step1 trước" >&2; exit 1; }
  cat "$SID_FILE"
}

need_work() { [[ -d "$WORK" ]] || { echo "Chưa có work/: chạy ./run.sh reset" >&2; exit 1; }; }

cmd_reset() {
  rm -rf "$WORK" "$OUT" "$SID_FILE" "$ROOT/.fresh_session_id" "$ROOT/.step4_mark"
  cp -r "$ROOT/codebase" "$WORK"
  echo "Đã tạo lại work/ ($(ls "$WORK" | wc -l) file), xoá out/ và .session_id"
}

cmd_step1() {
  need_work
  local sid; sid="$(cat /proc/sys/kernel/random/uuid)"
  echo "$sid" > "$SID_FILE"
  ask step1 "Review toàn bộ 10 file Ruby trong thư mục hiện tại (module CRM). Với mỗi vấn đề nêu: file, method, mô tả, mức độ (Critical/High/Medium/Low), đề xuất sửa. Cuối cùng liệt kê file không có vấn đề." \
    -n "$NAME" --session-id "$sid"
  echo "Phiên '$NAME' = $sid (resume tay: cd work && claude --resume $sid)"
}

cmd_step2() {
  local sid; sid="$(need_session)"
  ask step2 "Viết summary có cấu trúc cho phân tích vừa rồi, dạng bảng Markdown: | File | Vấn đề | Mức độ | Đề xuất |. Chỉ ghi kết luận, KHÔNG dán code hay output của tool. Thêm một dòng liệt kê file không có vấn đề. Chỉ in summary, không thêm lời dẫn." \
    --resume "$sid"
  cp "$OUT/step2.md" "$OUT/summary.md"
  echo "Summary → out/summary.md (đọc lại, sửa tay nếu cần trước step5)"
}

cmd_step3() {
  need_work
  for f in "${CHANGED[@]}"; do
    diff -u "$WORK/$f" "$ROOT/fixes/$f" > "$OUT/diff_$f.txt" 2>/dev/null || true
    cp "$ROOT/fixes/$f" "$WORK/$f"
  done
  echo "Đã thay 3 file trong work/: ${CHANGED[*]} (diff ở out/diff_*.txt)"
}

cmd_step4() {
  local sid; sid="$(need_session)"
  # Đánh dấu vị trí transcript trước step4 để compare chỉ đếm file Read trong step4
  wc -l < "$(transcript "$sid")" > "$ROOT/.step4_mark" 2>/dev/null || echo 0 > "$ROOT/.step4_mark"
  ask step4 "Mình quay lại tiếp tục. Liệt kê các vấn đề còn tồn tại trong auth.rb, session.rb và middleware.rb, kèm đề xuất sửa." \
    --resume "$sid"
}

cmd_step5() {
  need_work
  [[ -s "$OUT/summary.md" ]] || { echo "Chưa có out/summary.md: chạy step2" >&2; exit 1; }
  local sid; sid="$(cat /proc/sys/kernel/random/uuid)"
  echo "$sid" > "$ROOT/.fresh_session_id"
  local prompt
  prompt="Dưới đây là summary của một lần review trước đó cho thư mục này:

$(cat "$OUT/summary.md")

Kể từ lần review đó, ĐÚNG 3 file đã thay đổi: ${CHANGED[*]}. 7 file còn lại không đổi, giữ nguyên kết luận trong summary.
Hãy CHỈ đọc lại 3 file đã đổi (không đọc file khác) và cho biết: vấn đề nào trong summary đã được sửa, vấn đề nào còn, có vấn đề mới nào không, kèm đề xuất sửa."
  ask step5 "$prompt" -n "cca-1-7-fresh" --session-id "$sid"
}

cmd_step6() {
  local sid; sid="$(need_session)"
  local tr; tr="$(transcript "$sid")"
  local before; before=$(wc -l < "$tr" 2>/dev/null || echo 0)
  ask step6 "Giả sử chọn hướng thay toàn bộ Auth tự viết bằng Devise. Phác thảo kế hoạch 5 bước, không sửa file." \
    --resume "$sid" --fork-session
  local after; after=$(wc -l < "$tr" 2>/dev/null || echo 0)
  local fork_sid; fork_sid=$(ts session-id "$OUT/step6.json")
  echo "Phiên gốc $sid: $before → $after dòng transcript (fork không ghi vào phiên gốc)"
  echo "Phiên fork mới: $fork_sid ($( [[ "$fork_sid" != "$sid" ]] && echo 'khác ID gốc ✓' || echo 'TRÙNG ID ✗'))"
}

# Đường dẫn transcript của một phiên: ~/.claude/projects/<cwd, ký tự không phải chữ/số → '-'>/<id>.jsonl
transcript() {
  local enc; enc="$(echo "$WORK" | sed 's|[^a-zA-Z0-9]|-|g')"
  echo "$PROJECTS_DIR/$enc/$1.jsonl"
}

# Các file mà phiên đã Read (sau mốc dòng $2 nếu có), lấy từ transcript
reads_of() {
  local tr; tr="$(transcript "$1")"
  [[ -f "$tr" ]] || { echo "(không tìm thấy transcript $tr)"; return; }
  ts reads "$tr" "${2:-0}"
}

cmd_compare() {
  local s4="$OUT/step4.md" s5="$OUT/step5.md"
  [[ -s "$s4" && -s "$s5" ]] || { echo "Cần out/step4.md và out/step5.md" >&2; exit 1; }
  # check <mô tả> <regex> <kỳ vọng: absent|present> [regex loại trừ trên cùng dòng]
  # In ASCII cho cột kết quả để thẳng hàng; mô tả tiếng Việt để ở cột cuối.
  printf '%-7s %-7s %s\n' "step4" "step5" "Kiểm tra (theo ANSWER_KEY.md)"
  printf '%.0s-' {1..72}; echo
  check() {
    local label="$1" re="$2" want="$3" excl="${4:-}" res=() f n
    for f in "$s4" "$s5"; do
      if [[ -n "$excl" ]]; then
        n=$( { grep -iE "$re" "$f" || true; } | { grep -viE "$excl" || true; } | wc -l)
      else
        n=$(grep -ciE "$re" "$f" || true)
      fi
      if { [[ "$want" == absent && "$n" -eq 0 ]] || [[ "$want" == present && "$n" -gt 0 ]]; }; then
        res+=("OK"); else res+=("FAIL"); fi
    done
    printf '%-7s %-7s %s\n' "${res[0]}" "${res[1]}" "$label"
  }
  # Nhắc legacy_login mà KHÔNG kèm ý "đã xoá" → tham chiếu code không còn tồn tại
  check "Không coi legacy_login là còn tồn tại (method đã bị xoá)" 'legacy_login' absent \
        'đã (bị |được )?(xoá|xóa)|(has been|was) removed|deleted|không còn|no longer'
  check "Không đề xuất lại secure_compare (A1 đã sửa)" \
        'nên dùng .*secure_compare|use .*secure_compare|thay .*bằng .*secure_compare|secure_compare thay' absent
  check "Không đề xuất lại SecureRandom (S1 đã sửa)" \
        'nên dùng .*SecureRandom|use .*SecureRandom|thay .*bằng .*SecureRandom|SecureRandom thay' absent
  check "Vẫn báo SQL injection ở middleware (W1 còn)" 'SQL' present
  check "Phát hiện vấn đề MỚI: log header Authorization (N1)" 'authoriz' present
  echo
  echo "Dòng có nhắc tới legacy_login / secure_compare / SecureRandom (người chấm đọc ngữ cảnh):"
  for f in "$s4" "$s5"; do
    echo "  [$(basename "$f" .md)]"; grep -niE 'legacy_login|secure_compare|SecureRandom' "$f" | sed 's/^/    /' || echo "    (không có)"
  done
  echo
  if [[ -s "$SID_FILE" ]]; then
    echo "File đã Read — phiên gốc, riêng step4: $(reads_of "$(cat "$SID_FILE")" "$(cat "$ROOT/.step4_mark" 2>/dev/null || echo 0)")"
  fi
  if [[ -s "$ROOT/.fresh_session_id" ]]; then
    echo "File đã Read — phiên mới (step5):      $(reads_of "$(cat "$ROOT/.fresh_session_id")")"
  fi
  echo
  echo "Xem đầy đủ: out/step4.md (resume) và out/step5.md (fresh + summary)"
}

case "${1:-}" in
  reset|step1|step2|step3|step4|step5|step6|compare) "cmd_$1" ;;
  all) cmd_reset; cmd_step1; cmd_step2; cmd_step3; cmd_step4; cmd_step5; cmd_compare ;;
  *) sed -n '2,22p' "$0"; exit 1 ;;
esac
