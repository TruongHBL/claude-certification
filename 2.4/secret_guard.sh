#!/usr/bin/env bash
# Bài 2.4 – chặn commit secret: quét các dòng ĐƯỢC THÊM trong `git diff --cached` (mặc định)
# hoặc toàn bộ nội dung các file truyền vào. Có secret → in vị trí, exit 1.
#
# Dùng:  ./secret_guard.sh                 # trong một git repo, sau khi git add
#        ./secret_guard.sh file1 file2     # quét file bất kỳ
# Gắn làm pre-commit hook:  ln -s "$(pwd)/secret_guard.sh" .git/hooks/pre-commit
set -euo pipefail

# Cùng bộ mẫu với check_config.ts. "${VAR}" là placeholder hợp lệ, không bị coi là secret.
PATTERN='ghp_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|Bearer[[:space:]]+[A-Za-z0-9._~+/-]{20,}'

if [[ $# -gt 0 ]]; then
  hits="$(grep -nHE "$PATTERN" "$@" || true)"
else
  # Chỉ lấy dòng thêm mới (+), bỏ header "+++ b/file"; giữ tên file để báo vị trí.
  hits="$(git diff --cached --unified=0 --no-color | awk '
    /^\+\+\+ b\// { file = substr($0, 7); next }
    /^@@/ { split($3, a, ","); line = substr(a[1], 2) + 0; next }
    /^\+/ { print file ":" line ":" substr($0, 2); line++ }
  ' | grep -E "$PATTERN" || true)"
fi

if [[ -n "$hits" ]]; then
  echo "✗ Phát hiện giá trị trông như secret (dùng \${VAR} trong .mcp.json, để giá trị thật trong .env/shell):"
  echo "$hits" | sed 's/^/  /'
  exit 1
fi
echo "✓ Không thấy secret"
