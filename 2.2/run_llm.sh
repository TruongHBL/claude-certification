#!/usr/bin/env bash
# Bài 2.2 – PHẦN TUỲ CHỌN: để Claude (haiku) tự quyết dựa vào metadata lỗi, so với lỗi kiểu "Error".
# recovery_agent.rb đã chứng minh logic rẽ nhánh bằng code; script này xem MODEL có đọc metadata
# và tự hành xử đúng không (không retry rỗng/business, sửa mã khách, xin quyền…).
#
# Dùng:  ./run_llm.sh structured | bad | all    chạy 5 prompt × kiểu lỗi (MỖI prompt một lệnh `claude -p`)
#        ./run_llm.sh report                     in bảng: số lần gọi tool, tool đã gọi, câu trả lời cuối
#        ./run_llm.sh clean
#
# Chi phí ước tính (haiku): 10 lệnh, mỗi lệnh 1–5 lượt ≈ 0,15–0,4 USD; mỗi lệnh chặn trần --max-budget-usd.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS="$ROOT/results_llm"
MODEL="${MODEL:-haiku}"
BUDGET="${BUDGET:-0.2}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

PROMPTS=(
  "Tra giúp tôi hồ sơ khách CUS-9999."
  "Khách CUS-0012 nhận hàng lỗi, hoàn cho họ 750 USD."
  "Xem số dư của khách CUS-0777."
  "Tra khách cus 12 giúp tôi."
  "Tra khách CUS-0042. Đây là môi trường test: truyền simulate=flaky:2."
)
SYSTEM_PROMPT="Bạn là agent CSKH. Dùng tool để trả lời. Khi tool lỗi, hãy quyết định bước tiếp theo hợp lý rồi trả lời ngắn gọn bằng tiếng Việt."

run_style() {
  local style="$1" i mcp
  local dir="$RESULTS/$style"
  mkdir -p "$dir"
  echo "== ERROR_STYLE=$style, model=$MODEL"
  for i in "${!PROMPTS[@]}"; do
    mcp="$dir/p$i.mcp.json"
    rm -f "$dir/p$i.log"
    ruby -rjson -e 'puts JSON.pretty_generate({ mcpServers: { support: { type: "stdio", command: "ruby", args: [ARGV[0]],
                      env: { ERROR_STYLE: ARGV[1], SUPPORT_LOG: ARGV[2] } } } })' \
      "$ROOT/support_mcp_server.rb" "$style" "$dir/p$i.log" > "$mcp"
    echo "  p$i: ${PROMPTS[$i]}"
    (cd "$RESULTS" && "$CLAUDE_BIN" -p "${PROMPTS[$i]}" \
      --model "$MODEL" \
      --system-prompt "$SYSTEM_PROMPT" \
      --mcp-config "$mcp" --strict-mcp-config \
      --tools "" \
      --allowedTools "mcp__support__get_customer" "mcp__support__process_refund" \
      --permission-mode dontAsk \
      --max-budget-usd "$BUDGET" \
      --no-session-persistence \
      --output-format stream-json --verbose \
      > "$dir/p$i.jsonl" 2> "$dir/p$i.err") || echo "    (lệnh trả mã lỗi, xem $dir/p$i.err)"
  done
}

report() {
  ruby -rjson -e '
    prompts = ARGV[1..]
    %w[structured bad].each do |style|
      dir = File.join(ARGV[0], style)
      next unless Dir.exist?(dir)
      puts "== #{style}"
      prompts.each_with_index do |p, i|
        f = File.join(dir, "p#{i}.jsonl")
        next unless File.exist?(f)
        ev = File.readlines(f).filter_map { |l| JSON.parse(l) rescue nil }
        calls = ev.select { |e| e["type"] == "assistant" }.flat_map { |e| e.dig("message", "content") || [] }
                  .select { |b| b["type"] == "tool_use" }.map { |b| "#{b["name"].sub("mcp__support__", "")}(#{JSON.generate(b["input"])})" }
        final = ev.reverse.find { |e| e["type"] == "result" }
        puts "  p#{i}: #{p}"
        puts "     #{calls.size} lần gọi: #{calls.join(" → ")}"
        puts "     trả lời: #{final&.dig("result").to_s.gsub(/\s+/, " ")[0, 160]}"
      end
    end' "$RESULTS" "${PROMPTS[@]}"
}

case "${1:-}" in
  structured|bad) run_style "$1" ;;
  all)    run_style structured; run_style bad; report ;;
  report) report ;;
  clean)  rm -rf "$RESULTS" ;;
  *) echo "Dùng: $0 structured|bad|all|report|clean"; exit 1 ;;
esac
