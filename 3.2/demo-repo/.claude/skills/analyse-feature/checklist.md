# Rủi ro thường gặp khi phân tích một tính năng

File hỗ trợ của skill analyse-feature. Chỉ được đọc khi skill chạy (không nạp mọi phiên).

- Lời gọi async không `await` (lỗi bị nuốt, thứ tự sai).
- Tham số đổi chữ ký nhưng nơi gọi chưa cập nhật.
- Tên field lệch giữa các tầng (`user_id` và `userId`).
- Truy vấn ghép chuỗi (SQL injection).
- Thiếu kiểm tra trùng (ví dụ ♡ yêu thích bị lưu hai lần).
