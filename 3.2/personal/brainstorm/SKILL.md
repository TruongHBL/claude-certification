---
description: Brainstorm ý tưởng cho một tính năng hoặc một vùng code bằng cách đọc lan rộng codebase, rồi trả về vài hướng làm ngắn gọn. Skill cá nhân, không chia sẻ cho team.
argument-hint: "Provide a feature description or codebase area to explore."
context: fork
allowed-tools: Read Grep Glob
---

# Brainstorm: $ARGUMENTS

Bạn chạy trong subagent riêng (context: fork), nên được phép đọc nhiều và ghi chú dài: phần đó không quay về hội thoại chính.

1. Glob và Grep để khoanh vùng code liên quan tới "$ARGUMENTS".
2. Read các file chính, ghi lại điểm mạnh, điểm yếu, chỗ có thể mở rộng.
3. Nghĩ ra 3–5 hướng làm khác nhau.

**Chỉ trả về** bảng 3–5 dòng: Hướng làm | Lợi ích | Rủi ro | File cần sửa.

Mã nhận diện (cho bài tập 3.2): CANARY-PERSONAL-BRAIN-6B
