#!/usr/bin/env bash
# Bài 2.4 – PHẦN TUỲ CHỌN (chưa chạy): xem Claude chọn tool MCP hay tool built-in (Grep/Read)
# khi mô tả tool MCP sơ sài (DESC=sparse) so với mô tả đầy đủ (DESC=clear).
#
# Dùng:  ./run_cli.sh sparse | clear | all     mỗi câu hỏi một lệnh `claude -p` riêng (haiku)
#        ./run_cli.sh report                   bảng: tool nào được gọi, bao nhiêu lần, có đọc resource không
#        ./run_cli.sh clean
#
# Chi phí ước tính (haiku): 2 câu × 2 kiểu = 4 lệnh, mỗi lệnh 1–6 lượt. Bài 2.1 tốn ~0,002 USD/lệnh,
# bài này có thêm tool built-in nên ước ~0,01–0,05 USD tổng; mỗi lệnh chặn trần --max-budget-usd.
#
# Chạy trong demo-project/ (có mã nguồn giả để Grep "cạnh tranh") nhưng KHÔNG dùng .mcp.json của project
# (cần duyệt và GITHUB_TOKEN): cấu hình crm-db được sinh riêng và nạp bằng --mcp-config --strict-mcp-config.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$ROOT/demo-project"
RESULTS="${RESULTS_DIR:-$ROOT/results_cli}"
MODEL="${MODEL:-haiku}"
BUDGET="${BUDGET:-0.2}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
TS=(node --experimental-strip-types --no-warnings)

QUESTIONS=(
  "Trong hệ thống CRM hiện có dự án ngành điện nào đang mở với ngân sách từ 1 triệu yên trở lên? Chủ dự án là công ty nào?"
  "Bảng favorites trong DB CRM có những cột nào và liên kết với bảng nào?"
)

run_style() {
  local style="$1" dir="$RESULTS/$1" i mcp
  mkdir -p "$dir"
  mcp="$dir/mcp.json"
  node -e 'const [node, srv, desc, log] = process.argv.slice(1);
    console.log(JSON.stringify({ mcpServers: { "crm-db": { type: "stdio", command: node,
      args: ["--experimental-strip-types", "--no-warnings", srv],
      env: { DESC: desc, CRM_DB_URL: "sqlite://./crm.db", CRM_LOG: log } } } }, null, 2))' \
    "$(command -v node)" "$ROOT/crm_db_server.ts" "$style" "$dir/calls.log" > "$mcp"
  echo "== DESC=$style, model=$MODEL"
  for i in "${!QUESTIONS[@]}"; do
    echo "  q$i: ${QUESTIONS[$i]}"
    # Cho phép cả tool built-in (Read/Grep/Glob) lẫn tool MCP và 2 tool đọc resource của Claude Code,
    # để xem model chọn bên nào. (Tên ListMcpResourcesTool/ReadMcpResourceTool: chưa kiểm chứng với --tools.)
    (cd "$PROJECT" && "$CLAUDE_BIN" -p "${QUESTIONS[$i]}" \
      --model "$MODEL" \
      --mcp-config "$mcp" --strict-mcp-config \
      --tools Read Grep Glob ListMcpResourcesTool ReadMcpResourceTool \
      --allowedTools Read Grep Glob ListMcpResourcesTool ReadMcpResourceTool \
                     "mcp__crm-db__query_matching_projects" "mcp__crm-db__find_user" \
      --permission-mode dontAsk \
      --max-budget-usd "$BUDGET" \
      --no-session-persistence \
      --output-format stream-json --verbose \
      > "$dir/q$i.jsonl" 2> "$dir/q$i.err") || echo "    (lệnh trả mã lỗi, xem $dir/q$i.err)"
  done
}

case "${1:-}" in
  sparse|clear) run_style "$1" ;;
  all)    run_style sparse; run_style clear; "${TS[@]}" "$ROOT/report_cli.ts" "$RESULTS" ;;
  report) "${TS[@]}" "$ROOT/report_cli.ts" "$RESULTS" ;;
  clean)  rm -rf "$RESULTS" ;;
  *) sed -n '2,8p' "$0"; exit 1 ;;
esac
