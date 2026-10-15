---
paths:
  - "**/*.test.{ts,tsx}"
  - "**/*.spec.ts"
---

# Quy ước test

CANARY-RULE-TEST-5M

- Đặt tên theo hành vi: `describe("<đơn vị>")` + `it("<làm gì> khi <điều kiện>")`.
- Mỗi file có ít nhất một ca happy-path và một ca lỗi.
- Dữ liệu test tạo bằng hàm factory (`makeCustomer()`), không viết object literal lặp lại.
- Chỉ mock ở ranh giới module (API client, DB); không mock hàm nội bộ.
- Assert hành vi quan sát được (giá trị trả về, lỗi ném ra), không assert chi tiết cài đặt.
