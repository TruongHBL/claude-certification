# Package api – quy ước REST

Mã nhận diện file này (CLAUDE.md cấp thư mục): CANARY-DIR-API-9X

- Endpoint dùng danh từ số nhiều, kebab-case: `/matching-projects`, `/favorites`.
- Request/response body dùng camelCase; ngày giờ theo ISO 8601.
- Lỗi trả về HTTP status đúng nghĩa kèm body `{ errorCategory, isRetryable, description }`.
