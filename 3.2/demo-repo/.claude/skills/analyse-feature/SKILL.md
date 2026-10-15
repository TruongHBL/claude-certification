---
description: Phân tích sâu một tính năng hoặc một vùng code (luồng dữ liệu, file liên quan, rủi ro) và trả về bản tóm tắt ngắn. Dùng khi cần hiểu một tính năng trước khi sửa, ví dụ "phân tích tính năng favorites".
argument-hint: "[tên tính năng hoặc thư mục, ví dụ: favorites]"
context: fork
allowed-tools: Read Grep Glob
---

# Phân tích tính năng: $ARGUMENTS

Bạn chạy trong một subagent riêng. Không thấy lịch sử hội thoại chính, nên chỉ dựa vào hướng dẫn này.

1. Dùng Grep và Glob để tìm mọi file liên quan tới "$ARGUMENTS" trong `src/`.
2. Read từng file tìm được, lần theo import một bậc.
3. Ghi chú chi tiết trong lúc đọc (file, hàm, luồng dữ liệu). Phần ghi chú này ở lại trong subagent.
4. Đối chiếu với các rủi ro thường gặp trong [checklist.md](checklist.md).

**Chỉ trả về phiên chính** một bản tóm tắt tối đa 10 dòng:
- 1 dòng mô tả tính năng
- danh sách file chính (tối đa 5)
- tối đa 3 rủi ro, mỗi rủi ro một dòng có file:dòng

Mã nhận diện (cho bài tập 3.2): CANARY-SKILL-ANALYSE-8F
