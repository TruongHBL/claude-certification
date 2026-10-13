# Claude Certified Architect – Foundations: bài tập

Build Exercise theo từng mục của đề cương, mỗi mục một folder (`1.1/` … `2.3/`). Mỗi folder có trang nộp `bai-*.html`, mã nguồn, dữ liệu mẫu và test.

| Mục | Nội dung | Chạy bằng |
|---|---|---|
| 1.1 | Vòng lặp agent (stop_reason) | Messages API · CLI (`run_cli.sh`) |
| 1.2 | Hub-and-spoke | Messages API · CLI `--agents` |
| 1.3 | Truyền context cho subagent | Agent SDK (TS) · `run_cli.sh` |
| 1.4 | Prerequisite gate + handoff | Messages API · CLI + MCP server |
| 1.5 | Hook PreToolUse / PostToolUse | Agent SDK (TS) · shell hook |
| 1.6 | Multi-pass code review | Messages API · CLI `--json-schema` |
| 1.7 | Session: resume / fork / phiên mới | CLI |
| 2.1 | Mô tả tool chống chọn nhầm | CLI + MCP (đã chạy thật) |
| 2.2 | Lỗi có cấu trúc | Ruby thuần (đã chạy thật) · CLI tuỳ chọn |
| 2.3 | Phân bổ tool & tool_choice | Messages API · CLI + hook |

Bản CLI dùng phiên đăng nhập `claude` (claude.ai), không cần API key. Test dùng `claude` giả trong `test/bin/` trừ khi trang nộp ghi đã chạy thật.
