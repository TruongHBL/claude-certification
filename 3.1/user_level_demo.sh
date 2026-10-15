#!/usr/bin/env bash
# Bài 3.1 – bước 6: đặt NHẦM một quy ước team vào user-level CLAUDE.md để tái hiện bẫy "người mới vào team".
#
# Mặc định CHỈ IN (dry-run), không sửa gì. File đích: $USER_CLAUDE_MD (mặc định ~/.claude/CLAUDE.md).
#   ./user_level_demo.sh            in khối sẽ thêm
#   ./user_level_demo.sh --apply    backup rồi thêm khối giữa 2 dấu BEGIN/END (chạy lại không thêm trùng)
#   ./user_level_demo.sh --revert   backup rồi gỡ ĐÚNG khối đó, phần còn lại của file giữ nguyên
#   ./user_level_demo.sh --status   cho biết khối đang có trong file hay không
#
# Vì sao phải sửa file thật: Claude Code không có cờ/biến nào trỏ user-level CLAUDE.md sang file khác mà vẫn
# giữ đăng nhập (CLAUDE_CONFIG_DIR đổi cả thư mục chứa thông tin đăng nhập). Phiên "người mới clone" trong
# run_cli.sh dùng --setting-sources project,local thay cho việc xoá khối này.
set -euo pipefail

TARGET="${USER_CLAUDE_MD:-$HOME/.claude/CLAUDE.md}"
BEGIN="<!-- BEGIN cca-3.1-demo -->"
END="<!-- END cca-3.1-demo -->"
BLOCK="$BEGIN
## Quy ước API (đặt NHẦM ở user-level để tái hiện bẫy \"người mới vào team\", bài tập 3.1)
Mã nhận diện: CANARY-USER-3H
- Endpoint REST dùng kebab-case số nhiều.
$END"

has_block() { [[ -f "$TARGET" ]] && grep -qF "$BEGIN" "$TARGET"; }
backup() { [[ -f "$TARGET" ]] && cp -p "$TARGET" "$TARGET.bak-$(date +%Y%m%d%H%M%S)" && echo "Đã backup → $TARGET.bak-…"; }

case "${1:-}" in
  ""|--dry-run)
    echo "(dry-run) Sẽ thêm vào cuối $TARGET:"
    echo; echo "$BLOCK"; echo
    echo "Chạy với --apply để thêm thật, --revert để gỡ." ;;
  --apply)
    if has_block; then echo "Khối đã có trong $TARGET, không thêm lần nữa."; exit 0; fi
    mkdir -p "$(dirname "$TARGET")"; backup || true
    printf '\n%s\n' "$BLOCK" >> "$TARGET"
    echo "Đã thêm khối cca-3.1-demo vào $TARGET" ;;
  --revert)
    if ! has_block; then echo "Không có khối cca-3.1-demo trong $TARGET."; exit 0; fi
    backup
    node -e 'const fs=require("fs");const [f,b,e]=process.argv.slice(1);const s=fs.readFileSync(f,"utf8");
      const i=s.indexOf(b), j=s.indexOf(e,i);if(i<0||j<0)process.exit(1);
      let head=s.slice(0,i), tail=s.slice(j+e.length);
      if(head.endsWith("\n\n"))head=head.slice(0,-1); if(tail.startsWith("\n"))tail=tail.slice(1);
      fs.writeFileSync(f, head+tail);' "$TARGET" "$BEGIN" "$END"
    echo "Đã gỡ khối cca-3.1-demo khỏi $TARGET" ;;
  --status)
    if has_block; then echo "CÓ khối cca-3.1-demo trong $TARGET"; else echo "KHÔNG có khối cca-3.1-demo trong $TARGET"; fi ;;
  *) echo "Dùng: $0 [--dry-run|--apply|--revert|--status]"; exit 1 ;;
esac
