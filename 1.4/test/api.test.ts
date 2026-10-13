// Test bản Messages API bài 1.4 bằng transport GIẢ (không cần API key, không gọi model).
// Chuỗi tool_use được VIẾT SẴN theo kịch bản; transport kiểm history mỗi lượt (tool_result ghép đúng tool_use_id).
// Kiểm: cổng chặn chặn refund trước xác minh, handoff thiếu trường bị từ chối, ledger không có side effect sai.
// Chạy: node --experimental-strip-types test/api.test.ts
import type { ContentBlock, MessagesResponse, Transport } from "../../lib/anthropic.ts";
import { check, section, summary } from "../../lib/check.ts";
import { agent, runTool, scenarioText } from "../bai_1_4_prerequisite_gate.ts";
import { newState } from "../support_tools.ts";

const use = (id: string, name: string, input: Record<string, unknown>): ContentBlock => ({ type: "tool_use", id, name, input });
const txt = (text: string): ContentBlock => ({ type: "text", text });
const resp = (stop: MessagesResponse["stop_reason"], content: ContentBlock[]): MessagesResponse => ({
  id: "msg_fake", role: "assistant", content, stop_reason: stop,
});

const CONCERNS = [
  { type: "return", detail: "ORD-1002 ốp lưng sai màu – đã hoàn 45 USD (RF-1)", status: "resolved" },
  { type: "billing_dispute", detail: "visa-4242 bị trừ 2 lần cho ORD-1001 (120 USD); hệ thống đơn chỉ ghi 1 giao dịch", status: "needs_human" },
  { type: "account_update", detail: "Đổi địa chỉ giao hàng sang 12 Láng Hạ, Hà Nội – agent không có tool sửa tài khoản", status: "needs_human" },
];

const SKIP: MessagesResponse[] = [
  resp("tool_use", [txt("Khách vội, tôi hoàn tiền luôn."), use("s1", "process_refund", { customer_id: "C-001", order_id: "ORD-1001", amount: 120, reason: "hỏng" })]),
  resp("tool_use", [use("s2", "get_customer", { email: "an@example.com", phone_last4: "6789" })]),
  resp("tool_use", [use("s3", "process_refund", { customer_id: "C-001", order_id: "ORD-1001", amount: 120, reason: "Tai nghe hỏng" })]),
  resp("end_turn", [txt("Đã xác minh và hoàn 120 USD cho ORD-1001 (RF-1).")]),
];
const MULTI: MessagesResponse[] = [
  resp("tool_use", [txt("Có 3 vấn đề: trả hàng, trừ tiền 2 lần, đổi địa chỉ. Xác minh trước."), use("m1", "get_customer", { email: "an@example.com", phone_last4: "6789" })]),
  resp("tool_use", [use("m2", "lookup_order", { order_id: "ORD-1002" }), use("m3", "lookup_order", { order_id: "ORD-1001" })]),
  resp("tool_use", [use("m4", "process_refund", { customer_id: "C-001", order_id: "ORD-1002", amount: 45, reason: "Sai màu" })]),
  resp("tool_use", [use("m5", "escalate_to_human", {
    customer_id: "C-001", conversation_summary: "Khách có 3 yêu cầu", root_cause_analysis: "TBD",
    refund_amount: 45, recommended_action: "", concerns: CONCERNS.slice(0, 1),
  })]),
  resp("tool_use", [use("m6", "escalate_to_human", {
    customer_id: "C-001",
    conversation_summary: "Khách C-001 (đã xác minh) yêu cầu: trả ORD-1002, khiếu nại trừ tiền 2 lần ORD-1001, đổi địa chỉ.",
    root_cause_analysis: "Trả hàng: giao sai màu. Trừ 2 lần: hệ thống đơn chỉ có 1 giao dịch 120 USD → nghi lỗi cổng thanh toán. Địa chỉ: ngoài quyền agent.",
    refund_amount: 45,
    recommended_action: "Billing: đối soát visa-4242 với cổng thanh toán, hoàn 120 USD nếu trùng. CS: cập nhật địa chỉ 12 Láng Hạ, Hà Nội.",
    concerns: CONCERNS,
  })]),
  resp("end_turn", [txt("Đã hoàn 45 USD cho ORD-1002; 2 vấn đề còn lại đã chuyển nhân viên (HO-0001).")]),
];

// Transport GIẢ: chọn kịch bản theo câu hỏi đầu, kiểm system prompt và history mỗi lượt.
const fakeTransport: Transport = async (req) => {
  if (!req.system) throw new Error("thiếu system prompt");
  const step = req.messages.filter((m) => m.role === "assistant").length;
  if (step > 0) {
    const last = req.messages.at(-1)!;
    const prev = (req.messages.at(-2)!.content as ContentBlock[]).flatMap((b) => (b.type === "tool_use" ? [b.id] : []));
    const ids = Array.isArray(last.content) ? last.content.map((b: any) => b.tool_use_id) : [];
    if (last.role !== "user" || JSON.stringify(ids) !== JSON.stringify(prev)) throw new Error("history sai");
  }
  const script = String(req.messages[0].content).includes("KHÔNG cần xác minh") ? SKIP : MULTI;
  return script[Math.min(step, script.length - 1)];
};

for (const k of ["skip", "multi"]) {
  section(`Kịch bản ${k}`);
  const st = newState();
  const ans = await agent(scenarioText(k), st, fakeTransport);
  console.log(`Trả lời: ${ans}\nLedger: ${JSON.stringify(st.ledger)}`);
  check("ledger có đúng 1 refund", st.ledger.length === 1);
  check("khách đã xác minh", st.verified_customer_id === "C-001");
  if (k === "multi") check("handoff thiếu trường bị từ chối, bản đủ 5 trường được nhận", st.handoffs.length === 1);
}

section("Cổng chặn gọi trực tiếp");
let st = newState();
check("phiên mới: refund bị chặn", runTool(st, "process_refund", { customer_id: "C-001", order_id: "ORD-1001", amount: 1, reason: "x" })[1]);
st = newState();
runTool(st, "get_customer", { email: "an@example.com", phone_last4: "0000" });
check("sai 4 số cuối → không verify", st.verified_customer_id === null);
st.verified_customer_id = "C-001";
const [out, err] = runTool(st, "process_refund", { customer_id: "C-002", order_id: "ORD-2001", amount: 10, reason: "x" });
check("refund cho khách khác bị chặn", err && out.includes("khác khách"));
check("ledger rỗng sau các lệnh bị chặn", st.ledger.length === 0);
const [out2, err2] = runTool(st, "process_refund", { customer_id: "C-001" });
check("thiếu tham số bắt buộc → lỗi có cấu trúc", err2 && out2.includes("order_id"));

summary();
