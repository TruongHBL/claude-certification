# Claude Certified Architect – Foundations: bài tập

Build Exercise theo từng mục của đề cương, mỗi mục một folder (`1.1/` … `2.3/`). Mỗi folder có trang nộp `bai-*.html`, mã nguồn TypeScript, dữ liệu mẫu và test.

## Cài đặt

```bash
npm install          # typescript, @types/node, @anthropic-ai/claude-agent-sdk, zod
npm run typecheck    # tsc --strict, không build
npm test             # chạy mọi test/*.test.ts
```

Cần Node ≥ 22.6. File `.ts` chạy trực tiếp: `node --experimental-strip-types <file>.ts`.
Thư viện dùng chung nằm ở `lib/`: MCP server/client stdio, client Messages API viết bằng `fetch`, bộ test, hàm đọc `stream-json`.

## Bài tập

| Mục | Nội dung | Chạy bằng |
|---|---|---|
| 1.1 | Vòng lặp agent (stop_reason) | Messages API · CLI (`run_cli.sh`) |
| 1.2 | Hub-and-spoke | Messages API · CLI `--agents` |
| 1.3 | Truyền context cho subagent | Agent SDK · `run_cli.sh` |
| 1.4 | Prerequisite gate + handoff | Messages API · CLI + MCP server |
| 1.5 | Hook PreToolUse / PostToolUse | Agent SDK · shell hook |
| 1.6 | Multi-pass code review | Messages API · CLI `--json-schema` |
| 1.7 | Session: resume / fork / phiên mới | CLI (kịch bản demo: `1.7/DEMO.md`) |
| 2.1 | Mô tả tool chống chọn nhầm | CLI + MCP (đã chạy thật) |
| 2.2 | Lỗi có cấu trúc | Code tất định (đã chạy thật) · CLI tuỳ chọn |
| 2.3 | Phân bổ tool & tool_choice | Messages API · CLI + hook |

- **Bản Messages API** cần `ANTHROPIC_API_KEY`.
- **Bản CLI** (`run_cli.sh`, `run.sh`) dùng phiên đăng nhập `claude` (claude.ai), không cần API key.
- Test dùng `claude` giả trong `test/bin/`, trừ khi trang nộp ghi là đã chạy thật.
- Code Ruby trong `1.7/bai_1_7_session/codebase/` và `fixes/` là dữ liệu để Claude review, không phải code của bài.
