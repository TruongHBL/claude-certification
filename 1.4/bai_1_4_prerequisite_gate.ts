// Bài 1.4 – Build Exercise: Prerequisite Gate for Financial Operations (bản Messages API).
//
// Agent CSKH có 4 tool: get_customer, lookup_order, process_refund, escalate_to_human (xem support_tools.ts).
// - Cổng chặn (prerequisite gate) nằm trong CODE của handler process_refund, không nằm trong prompt:
//   chưa có get_customer trả về verified: true trong phiên này → trả lỗi BLOCKED, không thực thi.
// - escalate_to_human bắt buộc đủ 5 trường; validator trong code từ chối trường rỗng/placeholder.
//
// Chạy:  export ANTHROPIC_API_KEY=...
//        node --experimental-strip-types bai_1_4_prerequisite_gate.ts skip    # prompt ép bỏ qua xác minh
//        node --experimental-strip-types bai_1_4_prerequisite_gate.ts multi   # yêu cầu gồm 3 vấn đề → handoff
// Không có API key: dùng bản CLI (./run_cli.sh).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { httpTransport, textOf, toolUsesOf, type Message, type Transport, type UserBlock } from "../lib/anthropic.ts";
import { SYSTEM, TOOLS, ToolError, callTool, newState, type SessionState } from "./support_tools.ts";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
const MAX_ITERATIONS = 20; // lưới an toàn

/** Chạy một tool → [nội dung tool_result, is_error]. Lỗi có cấu trúc → Claude đọc được và tự xử lý. */
export function runTool(state: SessionState, name: string, input: Record<string, unknown>): [string, boolean] {
  try {
    const out = callTool(state, name, input);
    if (name === "escalate_to_human")
      console.log(`\n=== HANDOFF gửi nhân viên ===\n${JSON.stringify(state.handoffs.at(-1), null, 2)}\n`);
    return [JSON.stringify(out), false];
  } catch (e) {
    if (e instanceof ToolError) return [e.message, true];
    throw e;
  }
}

// ---------- Agentic loop (như bài 1.1) ----------
export async function agent(
  userMessage: string,
  state: SessionState = newState(),
  transport: Transport = httpTransport(),
): Promise<string | null> {
  const messages: Message[] = [{ role: "user", content: userMessage }];
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const r = await transport({ model: MODEL, max_tokens: 2000, system: SYSTEM, tools: TOOLS, messages });
    messages.push({ role: "assistant", content: r.content });

    if (r.stop_reason === "end_turn") return textOf(r);
    if (r.stop_reason !== "tool_use") throw new Error(`Dừng bất thường: stop_reason=${r.stop_reason}`);

    const results: UserBlock[] = toolUsesOf(r).map((b) => {
      const [out, err] = runTool(state, b.name, b.input);
      console.log(`[iter ${i}] ${b.name}${err ? " ✗" : ""} → ${out}`);
      return { type: "tool_result", tool_use_id: b.id, content: out, is_error: err };
    });
    messages.push({ role: "user", content: results });
  }
  console.warn(`CẢNH BÁO: chạm MAX_ITERATIONS=${MAX_ITERATIONS}`);
  return null;
}

/** Kịch bản dùng chung với bản CLI (scenarios.json): normal, skip, wrongphone, multi. */
export function scenarioText(id: string): string {
  const { scenarios } = JSON.parse(readFileSync(new URL("./scenarios.json", import.meta.url), "utf8")) as {
    scenarios: { id: string; text: string }[];
  };
  const s = scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`Không có kịch bản ${id} (có: ${scenarios.map((x) => x.id).join(", ")})`);
  return s.text;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const state = newState();
  console.log(await agent(scenarioText(process.argv[2] ?? "skip"), state));
  console.log(`\nLedger (refund đã thực thi): ${JSON.stringify(state.ledger)}`);
}
