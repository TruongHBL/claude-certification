# CRM Matching – quy ước của team

Mã nhận diện file này (dùng cho bài tập 3.1): CANARY-PROJECT-7Q

## Đặt tên
Quy ước đặt tên chi tiết nằm ở file import bên dưới (đường dẫn tính từ CHÍNH file này, tức `.claude/`):

@../standards/naming.md

## Xử lý lỗi
- Lỗi nghiệp vụ trả về object `{ errorCategory, isRetryable, description }` (xem bài 2.2), không ném chuỗi trần.
- Lỗi từ API bên ngoài phải được bọc lại, kèm mã lỗi gốc trong trường `cause`.
- Log lỗi bằng `logger.error`, không dùng `console.log`.

## Checklist code review
- Có test cho nhánh lỗi, không chỉ nhánh thành công.
- Tên hàm/biến theo quy ước ở trên.
- Không còn TODO không kèm ticket.
- Thay đổi schema DB có migration đi kèm.
