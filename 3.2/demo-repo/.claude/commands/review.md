---
description: Review code theo checklist chung của team (xử lý lỗi, test, đặt tên API, secret). Dùng trước khi mở PR.
argument-hint: "[file hoặc thư mục cần review, bỏ trống = thay đổi chưa commit]"
---

# Checklist review của team

Phạm vi review: $ARGUMENTS
(Nếu phạm vi trống: review các thay đổi chưa commit trong repo.)

Đi lần lượt từng mục, mỗi mục ghi **Đạt / Không đạt / Không áp dụng** kèm file:dòng.

1. **Xử lý lỗi**: mọi lời gọi I/O (DB, HTTP) có bắt lỗi; lỗi trả về theo dạng `{ errorCategory, isRetryable, description }` (bài 2.2), không nuốt lỗi im lặng.
2. **Test**: hàm mới hoặc hàm đổi hành vi có test tương ứng trong `*.test.ts` cùng thư mục.
3. **Đặt tên API**: endpoint REST dạng kebab-case số nhiều (`/matching-projects`), field JSON camelCase.
4. **Secret**: không có token, mật khẩu, khoá API ghi cứng trong code hay config; dùng biến môi trường.

Kết thúc bằng một dòng tổng: số mục Không đạt và mức độ cao nhất.

Mã nhận diện (cho bài tập 3.2): CANARY-CMD-REVIEW-5R
