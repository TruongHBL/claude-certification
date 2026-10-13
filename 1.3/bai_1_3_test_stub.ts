// Test hàm thuần của bài 1.3 bằng stream SDKMessage giả lập (không gọi API)
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { researchSpawnedInParallel, findingsSentToSynthesizer, verify, type Finding, type Report } from "./bai_1_3_context_passing.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) pass++; else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  → " + extra : ""}`);
}
const asst = (id: string, block: object, parent: string | null = null) =>
  ({ type: "assistant", parent_tool_use_id: parent, message: { id, content: [block] } }) as unknown as SDKMessage;
const agentCall = (id: string, type: string, prompt = "Câu hỏi: ...", name = "Agent") =>
  ({ type: "tool_use", id, name, input: { description: type, subagent_type: type, prompt } });

const findings: Finding[] = [
  { id: "W1", claim: "Làm từ xa tăng năng suất cá nhân ở tác vụ tập trung", analysis: "Phù hợp code/review", source_type: "web",
    source_url: "https://example.org/study-2025", document_name: null, page_number: null, confidence: "medium" },
  { id: "D1", claim: "68% nhân viên thấy focus time tăng khi ở nhà", analysis: "Khớp W1", source_type: "document",
    source_url: null, document_name: "khao-sat-noi-bo-2026.md", page_number: 2, confidence: "high" },
  { id: "D2", claim: "Review PR chậm hơn ngày ở nhà (9,5h so với 6,0h)", analysis: "Chi phí phối hợp", source_type: "document",
    source_url: null, document_name: "khao-sat-noi-bo-2026.md", page_number: 3, confidence: "high" },
];
const synthCall = (fs: unknown) => agentCall("tu_s", "synthesizer", `Câu hỏi...\n<findings>${JSON.stringify(fs)}</findings>`);

// Kịch bản A: coordinator phát 2 Agent call trong cùng response msg_1 (SDK stream thành 3 message cùng id)
const good: SDKMessage[] = [
  asst("msg_1", { type: "text", text: "Tôi sẽ giao song song cho 2 subagent." }),
  asst("msg_1", agentCall("tu_w", "web-researcher")),
  asst("msg_1", agentCall("tu_d", "doc-analyst")),
  // tin nhắn bên trong subagent (parent_tool_use_id != null) phải bị bỏ qua
  asst("sub_1", agentCall("tu_x", "web-researcher"), "tu_w"),
  asst("msg_2", synthCall(findings)),
];
const goodReport: Report = { summary: "...", claims: [
  { statement: "Làm ở nhà giúp tập trung hơn", finding_ids: ["W1", "D1"], citation: "https://example.org/study-2025; khao-sat-noi-bo-2026.md, tr. 2" },
  { statement: "Nhưng review PR chậm hơn", finding_ids: ["D2"], citation: "khao-sat-noi-bo-2026.md, tr. 3" },
]};
const vA = verify(good, goodReport);
console.log("Kịch bản A (đúng):", JSON.stringify(vA));
check("A: phát hiện spawn song song (gom theo message.id)", vA.parallel);
check("A: synthesizer nhận đủ 3 findings", vA.findingsSent === 3);
check("A: findings tới synthesizer giữ nguyên metadata (deep-equal)", JSON.stringify(findingsSentToSynthesizer(good)) === JSON.stringify(findings));
check("A: không lỗi metadata", vA.metadataErrors.length === 0);
check("A: không có claim mồ côi", vA.orphanClaims.length === 0);

// Kịch bản B: spawn tuần tự (2 response khác nhau) → không tính là song song
const seq: SDKMessage[] = [asst("msg_1", agentCall("tu_w", "web-researcher")), asst("msg_2", agentCall("tu_d", "doc-analyst"))];
check("B: spawn tuần tự bị phát hiện", !researchSpawnedInParallel(seq));

// Kịch bản C: tên tool cũ "Task" vẫn được nhận
const legacy: SDKMessage[] = [asst("m", agentCall("a", "web-researcher", "", "Task")), asst("m", agentCall("b", "doc-analyst", "", "Task"))];
check("C: tool tên cũ Task vẫn tính", researchSpawnedInParallel(legacy));

// Kịch bản D: coordinator "tóm tắt" làm rơi metadata trước khi gửi synthesizer
const lossy = findings.map((f) => ({ ...f, source_url: null, page_number: null }));
const vD = verify([...good.slice(0, 3), asst("msg_2", synthCall(lossy))], goodReport);
console.log("Kịch bản D (coordinator làm rơi metadata):", JSON.stringify(vD.metadataErrors));
check("D: bắt được 3 finding mất metadata", vD.metadataErrors.length === 3);

// Kịch bản E: báo cáo có claim mồ côi / id bịa / sai trang
const badReport: Report = { summary: "...", claims: [
  { statement: "Năng suất tăng 30%", finding_ids: [], citation: "" },
  { statement: "Đa số công ty bỏ hybrid", finding_ids: ["W9"], citation: "https://x.y" },
  { statement: "Review PR chậm hơn", finding_ids: ["D2"], citation: "khao-sat-noi-bo-2026.md, tr. 2" },
  { statement: "Focus time tăng", finding_ids: ["D1"], citation: "khao-sat-noi-bo-2026.md, tr. 12" },
]};
const vE = verify(good, badReport);
console.log("Kịch bản E (báo cáo xấu):", JSON.stringify(vE.orphanClaims));
check("E: bắt được 4 vấn đề trích dẫn (kể cả tr. 12 ≠ trang 2)", vE.orphanClaims.length === 4);

// Kịch bản F: không có thẻ <findings>
const vF = verify([...good.slice(0, 3), asst("msg_2", agentCall("tu_s", "synthesizer", "tự tổng hợp nhé"))], goodReport);
check("F: synthesizer không nhận findings → báo lỗi", vF.metadataErrors[0] === "Synthesizer không nhận được <findings>");

console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
