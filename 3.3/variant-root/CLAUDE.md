<!-- FILE SINH TỰ ĐỘNG bởi make_variant.ts từ demo-repo. Đừng sửa tay. -->

# CRM Matching – chuẩn chung của team

CANARY-ROOT-2K

- TypeScript strict, không dùng `any`.
- Tên biến, hàm: camelCase; tên type, class: PascalCase.
- Lỗi nghiệp vụ ném `AppError` có `code`; không nuốt lỗi bằng `catch {}` rỗng.
- Quy ước riêng cho test, API, hạ tầng nằm trong `.claude/rules/` và chỉ nạp khi làm việc với file khớp.

<!-- gộp từ .claude/rules/api-conventions.md (paths: src/api/**/*.ts, **/routes/**/*.ts, **/*.controller.ts) -->
# Quy ước API

CANARY-RULE-API-8T

- Mọi response theo envelope `{ data, error, meta }`.
- Validate input bằng Zod ngay tại handler, trước khi gọi service.
- Response lỗi luôn kèm `requestId` để tra log.
- Cấu hình rate limit tường minh cho từng route, không dựa vào mặc định.

<!-- gộp từ .claude/rules/terraform.md (paths: terraform/**/*, **/*.tf, infrastructure/**/*) -->
# Quy ước hạ tầng (Terraform)

CANARY-RULE-TF-3W

- State luôn ở remote backend (S3 + DynamoDB lock), không bao giờ để local.
- Tách môi trường bằng workspace (`dev`, `stg`, `prod`).
- Module có version cố định và CHANGELOG.
- Tên resource dạng snake_case, bắt buộc tag `env` và `team`.

<!-- gộp từ .claude/rules/testing.md (paths: **/*.test.{ts,tsx}, **/*.spec.ts) -->
# Quy ước test

CANARY-RULE-TEST-5M

- Đặt tên theo hành vi: `describe("<đơn vị>")` + `it("<làm gì> khi <điều kiện>")`.
- Mỗi file có ít nhất một ca happy-path và một ca lỗi.
- Dữ liệu test tạo bằng hàm factory (`makeCustomer()`), không viết object literal lặp lại.
- Chỉ mock ở ranh giới module (API client, DB); không mock hàm nội bộ.
- Assert hành vi quan sát được (giá trị trả về, lỗi ném ra), không assert chi tiết cài đặt.
