// Bài 1.1 – Build Exercise: Multi-Tool Agent Loop.
//
// Vòng lặp agent tự viết bằng Messages API với 2 tool (calculator, web_search giả lập).
// Điều khiển vòng lặp CHỈ bằng stop_reason: "tool_use" → chạy tool, nối kết quả, lặp tiếp;
// "end_turn" → trả kết quả. MAX_ITERATIONS chỉ là lưới an toàn.
//
// Chạy:  export ANTHROPIC_API_KEY=...
//        node --experimental-strip-types bai_1_1_agentic_loop.ts ["câu hỏi"]
// Không có API key: dùng bản CLI (./run_cli.sh).

import { pathToFileURL } from "node:url";
import { httpTransport, type Message, type Tool, type Transport, type UserBlock } from "../lib/anthropic.ts";
import { TOOL_SPECS, runTool } from "./tools.ts";

const MODEL = "claude-sonnet-5-5";
export const MAX_ITERATIONS = 20; // lưới an toàn, KHÔNG phải điều kiện dừng chính

export const TOOLS: Tool[] = TOOL_SPECS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));

// ---------- Agentic loop ----------
export async function agent(question: string, send: Transport, log = console.log): Promise<string | null> {
  const messages: Message[] = [{ role: "user", content: question }];
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const r = await send({ model: MODEL, max_tokens: 2000, tools: TOOLS, messages });
    messages.push({ role: "assistant", content: r.content }); // luôn nối lượt của Claude vào history

    switch (r.stop_reason) {
      case "end_turn":
        return r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      case "tool_use": {
        const results: UserBlock[] = r.content.flatMap((b) => {
          if (b.type !== "tool_use") return [];
          const [out, err] = runTool(b.name, b.input);
          log(`[iter ${i}] ${b.name}(${JSON.stringify(b.input)}) → ${out}`);
          return [{ type: "tool_result", tool_use_id: b.id, content: out, is_error: err }];
        });
        messages.push({ role: "user", content: results }); // mọi kết quả trong MỘT message user
        break;
      }
      default: // max_tokens, refusal, pause_turn... → không coi là xong, báo ra để xử lý
        throw new Error(`Dừng bất thường: stop_reason=${r.stop_reason}`);
    }
  }
  console.warn(`CẢNH BÁO: chạm MAX_ITERATIONS=${MAX_ITERATIONS} — vòng lặp có thể đang bị kẹt`);
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const q =
    process.argv[2] ??
    "Tổng dân số Hà Nội và TP. Hồ Chí Minh năm 2024 là bao nhiêu? TP. Hồ Chí Minh đông hơn Hà Nội bao nhiêu phần trăm?";
  console.log(await agent(q, httpTransport()));
}
