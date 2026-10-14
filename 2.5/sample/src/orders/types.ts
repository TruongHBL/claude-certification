// Kiểu dữ liệu dùng chung cho module đơn hàng.
export interface OrderResult {
  orderId: string;
  status: "processed" | "rejected";
  validated: boolean;
}

export interface ProcessOptions {
  /** Kiểm tra định dạng mã đơn (ORD-NNNN) trước khi xử lý. */
  validate: boolean;
}
