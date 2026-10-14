// Gửi mail giả lập: chỉ trả về nội dung sẽ gửi.
export function orderMail(to: string, orderId: string): string {
  return `To: ${to}\nĐơn ${orderId} của bạn đã được tiếp nhận.`;
}
