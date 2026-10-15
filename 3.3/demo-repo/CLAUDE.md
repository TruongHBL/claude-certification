# CRM Matching – chuẩn chung của team

CANARY-ROOT-2K

- TypeScript strict, không dùng `any`.
- Tên biến, hàm: camelCase; tên type, class: PascalCase.
- Lỗi nghiệp vụ ném `AppError` có `code`; không nuốt lỗi bằng `catch {}` rỗng.
- Quy ước riêng cho test, API, hạ tầng nằm trong `.claude/rules/` và chỉ nạp khi làm việc với file khớp.
