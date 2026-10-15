#!/usr/bin/env bash
# Bài 3.2 – bước 2: cài skill CÁ NHÂN /brainstorm vào ~/.claude/skills/brainstorm (user-level, không đi theo git).
#
# Mặc định CHỈ IN (dry-run), không ghi gì. Thư mục đích: $USER_SKILLS_DIR (mặc định ~/.claude/skills).
#   ./user_skill_demo.sh            in những gì sẽ làm
#   ./user_skill_demo.sh --apply    copy personal/brainstorm/ vào <đích>/brainstorm. TỪ CHỐI nếu thư mục đã có
#                                   (không ghi đè skill thật của bạn). Ghi file đánh dấu .cca-3.2-demo để biết
#                                   thư mục này do script tạo.
#   ./user_skill_demo.sh --revert   xoá <đích>/brainstorm CHỈ KHI có file đánh dấu (không bao giờ xoá skill khác)
#   ./user_skill_demo.sh --status   cho biết skill demo đang được cài hay không
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT/personal/brainstorm"
DEST_DIR="${USER_SKILLS_DIR:-$HOME/.claude/skills}"
DEST="$DEST_DIR/brainstorm"
MARK=".cca-3.2-demo"

case "${1:-}" in
  ""|--dry-run)
    echo "(dry-run) Sẽ copy:"
    echo "  $SRC/  →  $DEST/"
    for f in "$SRC"/*; do echo "    $(basename "$f")"; done
    echo "  và ghi file đánh dấu $DEST/$MARK"
    if [[ -e "$DEST" ]]; then echo "Lưu ý: $DEST đã tồn tại, --apply sẽ từ chối."; fi
    echo "Chạy với --apply để cài thật, --revert để gỡ." ;;
  --apply)
    if [[ -e "$DEST" ]]; then
      if [[ -f "$DEST/$MARK" ]]; then echo "Skill demo đã được cài ở $DEST."; exit 0; fi
      echo "TỪ CHỐI: $DEST đã tồn tại và không phải do script này tạo. Không ghi đè." >&2; exit 1
    fi
    mkdir -p "$DEST_DIR"
    cp -r "$SRC" "$DEST"
    echo "Tạo bởi user_skill_demo.sh (bài tập 3.2). Gỡ bằng: $ROOT/user_skill_demo.sh --revert" > "$DEST/$MARK"
    echo "Đã cài skill cá nhân /brainstorm vào $DEST" ;;
  --revert)
    if [[ ! -e "$DEST" ]]; then echo "Không có $DEST."; exit 0; fi
    if [[ ! -f "$DEST/$MARK" ]]; then echo "TỪ CHỐI: $DEST không có file đánh dấu, không phải do script tạo. Không xoá." >&2; exit 1; fi
    rm -rf -- "$DEST"
    echo "Đã gỡ $DEST" ;;
  --status)
    if [[ -f "$DEST/$MARK" ]]; then echo "ĐÃ CÀI skill demo /brainstorm ở $DEST"
    elif [[ -e "$DEST" ]]; then echo "CÓ $DEST nhưng KHÔNG phải skill demo (không có file đánh dấu)"
    else echo "CHƯA CÀI skill demo /brainstorm ($DEST không tồn tại)"; fi ;;
  *) echo "Dùng: $0 [--dry-run|--apply|--revert|--status]"; exit 1 ;;
esac
