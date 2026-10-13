#!/usr/bin/env bash
# Bài 1.5 – chạy bản Agent SDK (bai_1_5_sdk_hooks.ts --run) KHÔNG cần API key.
#
# Agent SDK không tự gọi API: nó spawn binary Claude Code rồi nói chuyện qua stream-json.
# Binary đó đọc cùng thông tin đăng nhập với `claude` (~/.claude/.credentials.json), nên khi
# không có ANTHROPIC_API_KEY nó dùng phiên đăng nhập claude.ai → tính vào quota gói, không cần key.
#
# Dùng:  ./run_cli.sh
#   CLAUDE_BIN=...        binary Claude Code (mặc định: `command -v claude`, tức bản CLI bạn đã đăng nhập).
#                         Để trống hẳn (CLAUDE_BIN=) thì SDK dùng binary đóng gói trong node_modules.
#   Thư viện: dùng node_modules ở thư mục gốc repo (Node tự tìm ngược lên thư mục cha). Chưa có thì tự chạy npm install ở gốc.
#
# Chi phí ước tính: 3 prompt, mỗi prompt 2–6 lượt, model mặc định của tài khoản. Tương đương ~0,2–0,6 USD giá API;
# với gói claude.ai thì trừ vào hạn mức sử dụng.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN   # ép dùng phiên đăng nhập CLI
CLAUDE_BIN="${CLAUDE_BIN-$(command -v claude || true)}"
export CLAUDE_BIN

AUTH_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"
[ -n "$AUTH_BIN" ] || { echo "Không tìm thấy claude CLI. Cài Claude Code rồi chạy: claude  (đăng nhập /login)"; exit 1; }
if ! "$AUTH_BIN" auth status 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.exit(JSON.parse(s).loggedIn===true?0:1)}catch{process.exit(1)}})'; then
  echo "Claude Code chưa đăng nhập. Chạy: claude  rồi gõ /login"; exit 1
fi

REPO="$(cd "$ROOT/.." && pwd)"   # gốc repo: package.json + node_modules dùng chung cho mọi bài
if [ ! -d "$REPO/node_modules/@anthropic-ai/claude-agent-sdk" ]; then
  echo "Cài @anthropic-ai/claude-agent-sdk + zod vào $REPO/node_modules ..."
  (cd "$REPO" && npm install --no-audit --no-fund)
fi

echo "Claude Code binary: ${CLAUDE_BIN:-<bản đóng gói trong SDK>}"
exec node --experimental-strip-types --no-warnings "$ROOT/bai_1_5_sdk_hooks.ts" --run
