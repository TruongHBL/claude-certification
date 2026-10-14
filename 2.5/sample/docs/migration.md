# Chuyển từ processLegacyOrder sang processOrder

```ts
// Cũ
processLegacyOrder(orderId);
// Mới
processOrder(orderId, { validate: true });
```

`processOrder` ném lỗi nếu mã đơn không đúng định dạng `ORD-NNNN`.
