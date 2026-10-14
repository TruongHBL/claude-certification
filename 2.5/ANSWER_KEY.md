# Answer key: Bài 2.5 (codebase `sample/`)

Đặt ngoài `sample/` để Claude không đọc được khi chạy `run_cli.sh` (Claude chỉ làm việc trong `.work/`).

## Hàm cần thay

- Deprecated: `processLegacyOrder(orderId)` ở `src/orders/legacy.ts`
- Mới: `processOrder(orderId, { validate: true })` ở `src/orders/process.ts`

## Caller (5 nhóm)

| # | File | Cách dùng | Grep tên gốc có thấy không |
|---|---|---|---|
| 1 | `src/checkout/checkout_service.ts` | Gọi trực tiếp | Có |
| 2 | `src/crm/customer_reorder.ts` | Gọi trực tiếp | Có |
| 3 | `src/admin/bulk_reprocess.ts` | Gọi trực tiếp, **2 dòng giống hệt nhau** `results.push(processLegacyOrder(id));` | Có |
| 4 | `src/orders/apply.ts` → dùng ở `src/jobs/nightly_sync.ts` | **Wrapper** `applyLegacyOrder` | Thấy wrapper, KHÔNG thấy `nightly_sync.ts` |
| 5 | `src/api/order_routes.ts` | Qua **barrel** `src/utils/index.ts`: `export { processLegacyOrder as submitLegacyOrder }` | **Không**: consumer chỉ dùng `submitLegacyOrder` |

Nhóm 4: sửa thân wrapper (gọn nhất) hoặc sửa `nightly_sync.ts` đều được tính.

## Test liên quan (Glob `**/*.test.ts` rồi ghép theo tên file)

- `src/checkout/checkout_service.test.ts`: gọi `checkoutCart`, **không nhắc tên hàm** (grep không thấy)
- `src/crm/customer_reorder.test.ts`
- `src/admin/bulk_reprocess.test.ts`
- `src/api/order_routes.test.ts`
- `src/jobs/nightly_sync.test.ts`
- `src/orders/legacy.test.ts`: test của chính hàm deprecated, giữ nguyên

## Bẫy

| Bẫy | Ở đâu | Bắt lỗi cách làm nào |
|---|---|---|
| Barrel đổi tên | `src/utils/index.ts` → `src/api/order_routes.ts` | Chỉ Grep tên gốc một lần |
| Wrapper | `src/orders/apply.ts` → `src/jobs/nightly_sync.ts` | Không Grep tên wrapper |
| Non-unique | `src/admin/bulk_reprocess.ts` dòng 8 và 11 | Edit với old_string ngắn |
| Tên file chứa "legacy" nhưng không gọi hàm | `src/legacy/legacy_pricing.ts`, `src/utils/legacy_dates.ts` | Dùng Glob `*legacy*` để tìm caller |
| Nhắc tên hàm nhưng không phải lời gọi | `CHANGELOG.md`, `docs/migration.md`, `src/i18n/messages.ts`, comment trong `process.ts` | Sửa mọi kết quả Grep mà không đọc |
| Test gián tiếp | `checkout_service.test.ts` | Chỉ dùng Grep để tìm test |
| File nhiễu | ~15 file không liên quan | Đọc hết mọi file từ đầu |

## Chuỗi tool đúng

1. **Grep** `processLegacyOrder` → caller trực tiếp, wrapper, dòng barrel, (và bẫy false positive)
2. **Read** `src/utils/index.ts`, `src/orders/apply.ts` → thấy tên mới `submitLegacyOrder`, `applyLegacyOrder`
3. **Grep** `submitLegacyOrder`, `applyLegacyOrder` → `order_routes.ts`, `nightly_sync.ts`
4. **Glob** `**/*.test.ts` → test cạnh từng caller
5. **Read** từng caller (Claude Code bắt buộc Read trước Edit)
6. **Edit** từng chỗ; ở `bulk_reprocess.ts` Edit báo `Found 2 matches…` → mở rộng `old_string` hoặc `replace_all: true` (đáp án đề thi: Read + Write)
7. (Tuỳ chọn) xoá dòng re-export trong barrel khi không còn ai dùng

Số file cần Read: khoảng 7–10 trên 33 file.
