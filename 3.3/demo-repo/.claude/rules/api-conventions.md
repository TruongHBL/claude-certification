---
paths:
  - "src/api/**/*.ts"
  - "**/routes/**/*.ts"
  - "**/*.controller.ts"
---

# Quy ước API

CANARY-RULE-API-8T

- Mọi response theo envelope `{ data, error, meta }`.
- Validate input bằng Zod ngay tại handler, trước khi gọi service.
- Response lỗi luôn kèm `requestId` để tra log.
- Cấu hình rate limit tường minh cho từng route, không dựa vào mặc định.
