#!/usr/bin/env bash
# Bài 1.3 – chạy bản Agent SDK (bai_1_3_context_passing.ts) KHÔNG cần API key.
#
# Agent SDK không tự gọi API: nó spawn binary Claude Code rồi nói chuyện qua stream-json.
# Binary đó đọc cùng thông tin đăng nhập với `claude` (~/.claude/.credentials.json), nên khi
# không có ANTHROPIC_API_KEY nó dùng phiên đăng nhập claude.ai → tính vào quota gói, không cần key.
#
# Dùng:  ./run_cli.sh ["câu hỏi"]
#   CLAUDE_BIN=...        binary Claude Code (mặc định: `command -v claude`, tức bản CLI bạn đã đăng nhập).
#                         Để trống hẳn (CLAUDE_BIN=) thì SDK dùng binary đóng gói trong node_modules.
#   SDK_NODE_MODULES=...  thư mục node_modules có sẵn @anthropic-ai/claude-agent-sdk → tạo symlink thay vì npm i.
#
# Chi phí ước tính: 1 coordinator + 3 subagent (có WebSearch/WebFetch), model mặc định của tài khoản.
# Tương đương ~0,5–2 USD giá API (code đặt maxBudgetUsd: 2); với gói claude.ai thì trừ vào hạn mức sử dụng.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN   # ép dùng phiên đăng nhập CLI
CLAUDE_BIN="${CLAUDE_BIN-$(command -v claude || true)}"
export CLAUDE_BIN

AUTH_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"
[ -n "$AUTH_BIN" ] || { echo "Không tìm thấy claude CLI. Cài Claude Code rồi chạy: claude  (đăng nhập /login)"; exit 1; }
if ! "$AUTH_BIN" auth status 2>/dev/null | ruby -rjson -e 'exit(JSON.parse($stdin.read)["loggedIn"] == true ? 0 : 1)'; then
  echo "Claude Code chưa đăng nhập. Chạy: claude  rồi gõ /login"; exit 1
fi

NM="$ROOT/node_modules"
[ -L "$NM" ] && [ ! -e "$NM" ] && rm -f "$NM"      # symlink hỏng (vd trỏ vào thư mục tạm đã xoá)
if [ ! -d "$NM/@anthropic-ai/claude-agent-sdk" ]; then
  if [ -n "${SDK_NODE_MODULES:-}" ]; then
    ln -s "$SDK_NODE_MODULES" "$NM"
  else
    echo "Cài @anthropic-ai/claude-agent-sdk vào $NM ..."
    (cd "$ROOT" && npm i --no-save --no-audit --no-fund --no-package-lock @anthropic-ai/claude-agent-sdk@0.3.293)
  fi
fi

echo "Claude Code binary: ${CLAUDE_BIN:-<bản đóng gói trong SDK>}"
exec node --experimental-strip-types --no-warnings "$ROOT/bai_1_3_context_passing.ts" "$@"
