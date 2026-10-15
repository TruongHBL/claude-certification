# CRM matching: quy ước chung (luôn nạp)

- Endpoint REST dạng kebab-case số nhiều: `/matching-projects`, `/favorites`.
- Field JSON camelCase (`userId`, không dùng `user_id`).
- Lỗi trả về dạng `{ errorCategory, isRetryable, description }`.
- Quy trình review nhiều bước KHÔNG đặt ở đây: dùng lệnh `/review` (`.claude/commands/review.md`).
