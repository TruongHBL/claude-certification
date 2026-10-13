# Answer key: Bài 1.7

## Codebase ban đầu (10 file, 7 vấn đề)

| ID | File | Vấn đề | Mức độ |
|---|---|---|---|
| M1 | matching.rb | N+1 query: mỗi user lại query `Skill.where(user_id:)` | Medium |
| F1 | favorite.rb | Thiếu `validates :project_id, uniqueness: { scope: :user_id }`, ♡ bị trùng | Medium |
| A1 | auth.rb | So sánh password digest bằng `==` (timing attack) | High |
| A2 | auth.rb | `legacy_login` dùng MD5 không salt | High |
| S1 | session.rb | Token phiên sinh bằng `rand`, không an toàn | High |
| W1 | middleware.rb | `find_tenant` nội suy chuỗi vào SQL (SQL injection) | Critical |
| C1 | matching_controller.rb | `permit!`, mass assignment (gán được role/admin) | High |

Không có vấn đề: user.rb, report.rb, notifier.rb, config.rb.

## Sau bước 3 (copy `fixes/` đè 3 file)

| File | Thay đổi | Trạng thái đúng sau khi sửa |
|---|---|---|
| auth.rb | A1 đã sửa (`secure_compare`). **Method `legacy_login` đã bị XOÁ**, nên A2 không còn | Không còn vấn đề |
| session.rb | S1 đã sửa (`SecureRandom.urlsafe_base64(32)`) | Không còn vấn đề |
| middleware.rb | W1 **vẫn còn**. **Vấn đề MỚI N1:** `Rails.logger.info` ghi cả header `Authorization` (lộ token vào log) | Còn W1 + N1 |

## Dấu hiệu stale context (bước 4, resume)

- Nhắc tới `legacy_login` như thể vẫn tồn tại → **tham chiếu code đã xoá**.
- Đề xuất "dùng `secure_compare`" hoặc "dùng `SecureRandom`" → **đề xuất fix đã làm rồi**.
- Không nhắc tới việc log header `Authorization` (N1) → **bỏ sót vấn đề mới**, vì đang dựa vào kết quả đọc file cũ.
- Mâu thuẫn về auth.rb (lúc nói còn lỗi, lúc nói đã sửa) → trộn lần đọc cũ và mới.

## Kết quả mong đợi (bước 5, fresh start + summary)

- auth.rb, session.rb: xác nhận A1/S1 đã sửa, A2 không còn (method đã xoá).
- middleware.rb: W1 vẫn còn **và** phát hiện N1.
- Chỉ đọc 3 file đã đổi, không đọc lại 7 file còn lại.
