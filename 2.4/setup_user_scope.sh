#!/usr/bin/env bash
# Bài 2.4 – bước 3: thêm một server CÁ NHÂN / thử nghiệm ở user scope (~/.claude.json, ngoài repo).
# Mặc định chỉ IN lệnh (dry-run). Không tự sửa ~/.claude.json của bạn.
#
# Dùng:  ./setup_user_scope.sh            # in lệnh add sẽ chạy
#        ./setup_user_scope.sh --apply    # chạy thật: claude mcp add --scope user …
#        ./setup_user_scope.sh --remove   # in lệnh gỡ; thêm --apply để gỡ thật
#        ./setup_user_scope.sh --check    # claude mcp get <tên> (health check, không gọi model)
#
# Server mẫu: crm-db bản thử nghiệm với mô tả sparse, chỉ mình bạn thấy, mọi project đều dùng được.
# Muốn chia sẻ cho team thì KHÔNG dùng user scope, mà khai báo trong .mcp.json của repo (demo-project/).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE="${CLAUDE_BIN:-claude}"
NAME="${SERVER_NAME:-crm-db-experimental}"
NODE="$(command -v node)"

ADD=("$CLAUDE" mcp add --scope user "$NAME"
     -e DESC=sparse -e "CRM_DB_URL=sqlite://$HOME/.local/share/crm-experimental.db"
     -- "$NODE" --experimental-strip-types --no-warnings "$ROOT/crm_db_server.ts")
REMOVE=("$CLAUDE" mcp remove --scope user "$NAME")
GET=("$CLAUDE" mcp get "$NAME")

mode=add apply=0
for a in "$@"; do
  case "$a" in
    --apply) apply=1 ;;
    --remove) mode=remove ;;
    --check) mode=check ;;
    *) echo "Tham số lạ: $a"; sed -n '2,10p' "$0"; exit 1 ;;
  esac
done

show() { printf '  %q' "$@"; echo; }
case "$mode" in
  add)    cmd=("${ADD[@]}") ;;
  remove) cmd=("${REMOVE[@]}") ;;
  check)  "${GET[@]}"; exit $? ;;
esac

if [[ "$apply" == 1 ]]; then
  echo "▶ Chạy:"; show "${cmd[@]}"
  "${cmd[@]}"
  if [[ "$mode" == add ]]; then echo "Gỡ lại bằng: $0 --remove --apply"; fi
else
  echo "(dry-run) Lệnh sẽ chạy — thêm --apply để chạy thật:"; show "${cmd[@]}"
  if [[ "$mode" == add ]]; then echo "Gỡ:"; show "${REMOVE[@]}"; fi
fi
