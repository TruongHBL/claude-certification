// PreToolUse(mcp__ops__process_refund): refund > $500 (hoặc số tiền không hợp lệ) → deny + ghi hàng đợi người duyệt.
import { REFUND_LIMIT_USD, appendJsonl, deny, hookInput } from "./lib.ts";

const inp = hookInput();
const rawAmount = inp.tool_input?.amount_usd;
// Chỉ nhận số hoặc chuỗi số hợp lệ; còn lại (vd "abc", null) coi như không hợp lệ
const amount = typeof rawAmount === "number" ? rawAmount : typeof rawAmount === "string" && rawAmount.trim() !== "" ? Number(rawAmount) : NaN;
if (!(Number.isFinite(amount) && amount <= REFUND_LIMIT_USD)) {
  const reason =
    `Refund $${rawAmount} vượt hạn mức $${REFUND_LIMIT_USD}. Không tự xử lý; ` +
    "đã chuyển cho nhân viên duyệt (escalation). Hãy báo khách là yêu cầu đang chờ duyệt.";
  appendJsonl("escalations.jsonl", { session_id: inp.session_id, tool: inp.tool_name, input: inp.tool_input, reason });
  deny(reason);
}
