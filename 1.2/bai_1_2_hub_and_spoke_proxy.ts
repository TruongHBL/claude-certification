// Bài 1.2 – Build Exercise (bản chạy qua proxy OpenAI-compatible, KHÔNG phải Claude API chính thức).
//
// Khác bản chính:
//   - Gọi /v1/chat/completions bằng fetch (không cần thư viện).
//   - Vòng lặp dựa vào finish_reason ("tool_calls" / "stop") thay cho stop_reason ("tool_use" / "end_turn").
//   - Không có server tool web_search của Anthropic → subagent tìm kiếm dùng tool `search` GIẢ LẬP chạy local.
//
// Chạy:  export PROXY_API_KEY=...
//        export PROXY_MODEL=...        # tên model theo nhà cung cấp proxy
//        export PROXY_BASE_URL=https://api.xah.io/v1   # (mặc định)
//        node --experimental-strip-types bai_1_2_hub_and_spoke_proxy.ts ["chủ đề"]

import { pathToFileURL } from "node:url";

const BASE_URL = process.env.PROXY_BASE_URL ?? "https://api.xah.io/v1";
const MAX_TOOL_TURNS = 10; // lưới an toàn cho vòng lặp tool, không phải điều kiện dừng chính

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}
interface Choice {
  finish_reason: string;
  message: ChatMessage;
}
export type ChatFn = (messages: ChatMessage[], tools?: unknown[]) => Promise<Choice>;

const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "search",
    description: "Tìm thông tin về một chủ đề. Trả về danh sách kết quả ngắn kèm nguồn.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Câu truy vấn tìm kiếm" } },
      required: ["query"],
    },
  },
};

// Tool tìm kiếm GIẢ LẬP – thay bằng API tìm kiếm thật nếu cần.
export const fakeSearch = (query: string) =>
  `[MOCK] 3 kết quả cho '${query}':\n` +
  `- Tổng quan về ${query} (nguồn: example.com/a)\n` +
  `- Số liệu gần đây về ${query} (nguồn: example.com/b)\n` +
  `- Thách thức và triển vọng của ${query} (nguồn: example.com/c)`;

/** Chat thật qua proxy (cần PROXY_MODEL, PROXY_API_KEY). */
export function httpChat(): ChatFn {
  const model = process.env.PROXY_MODEL;
  const key = process.env.PROXY_API_KEY;
  if (!model) throw new Error(`Thiếu PROXY_MODEL (xem danh sách model của proxy: GET ${BASE_URL}/models)`);
  if (!key) throw new Error("Thiếu PROXY_API_KEY");
  return async (messages, tools) => {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: 4000, messages, ...(tools ? { tools } : {}) }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    return ((await res.json()) as { choices: Choice[] }).choices[0]!;
  };
}

export function proxyHub(chat: ChatFn, log: (s: string) => void = console.log) {
  // Mỗi lần gọi = context MỚI. Subagent chỉ biết những gì nằm trong `task`.
  async function runAgent(system: string, task: string, tools?: unknown[]): Promise<string> {
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: task },
    ];
    for (let i = 0; i < MAX_TOOL_TURNS; i++) {
      const choice = await chat(messages, tools);
      const msg = choice.message;
      switch (choice.finish_reason) {
        case "tool_calls": // tương đương stop_reason "tool_use" → chạy tool, nối kết quả, lặp tiếp
          messages.push(msg);
          for (const tc of msg.tool_calls ?? []) {
            const args = JSON.parse(tc.function.arguments || "{}") as { query?: string };
            messages.push({ role: "tool", tool_call_id: tc.id, content: fakeSearch(String(args.query ?? "")) });
          }
          break;
        case "stop": // tương đương "end_turn" → xong
          return String(msg.content ?? "");
        default: // "length", "content_filter"... → chưa hoàn chỉnh, cần kiểm tra
          console.warn(`CẢNH BÁO: finish_reason=${choice.finish_reason}`);
          return String(msg.content ?? "");
      }
    }
    console.warn("CẢNH BÁO: chạm MAX_TOOL_TURNS");
    return "";
  }

  async function askJson(system: string, task: string): Promise<string[]> {
    const text = await runAgent(system, `${task}\nChỉ trả về một JSON array các chuỗi, không giải thích.`);
    return JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as string[];
  }

  // ---------- Subagents (spoke) ----------
  const searchSubagent = (topic: string, sub: string) =>
    runAgent(
      "Bạn là subagent tìm kiếm thông tin. Hãy dùng tool search trước khi trả lời.",
      `Bối cảnh: team đang viết báo cáo về '${topic}'.\n` +
        `Nhiệm vụ: tìm thông tin về '${sub}'.\n` +
        `Ranh giới: CHỈ viết về '${sub}', không lấn sang nhánh khác.\n` +
        "Output: 5–8 gạch đầu dòng, mỗi dòng kèm nguồn.",
      [SEARCH_TOOL],
    );

  const analysisSubagent = (topic: string, sub: string, findings: string) =>
    runAgent(
      "Bạn là subagent phân tích tài liệu.",
      `Báo cáo về '${topic}', phần '${sub}'.\n` +
        `Dữ liệu (do coordinator chuyển, chỉ được dùng dữ liệu này):\n${findings}\n` +
        "Output: 1 đoạn gồm hiện trạng, ưu điểm, hạn chế, triển vọng.",
    );

  // ---------- Coordinator (hub) ----------
  const decompose = (topic: string) =>
    askJson(
      "Bạn là coordinator của hệ thống research.",
      `Chia chủ đề '${topic}' thành các nhánh con bao phủ TOÀN BỘ phạm vi (tối thiểu 5), không trùng lặp nhau.`,
    );

  const findGaps = (topic: string, covered: string[]) =>
    askJson(
      "Bạn là coordinator, đang kiểm tra độ phủ của báo cáo.",
      `Chủ đề: '${topic}'. Các nhánh đã có: ${JSON.stringify(covered)}.\n` +
        "Liệt kê các nhánh QUAN TRỌNG còn thiếu. Trả [] nếu đã đủ.",
    );

  async function coordinator(topic: string, maxRounds = 3): Promise<string> {
    const sections = new Map<string, string>();
    let todo = await decompose(topic);
    log(`Phân rã: ${JSON.stringify(todo)}`);
    for (let rnd = 0; rnd < maxRounds; rnd++) {
      // lưới an toàn, không phải điều kiện dừng chính
      for (const sub of todo) {
        const findings = await searchSubagent(topic, sub); // spoke 1
        sections.set(sub, await analysisSubagent(topic, sub, findings)); // coordinator chuyển dữ liệu sang spoke 2
        log(`[round ${rnd}] xong nhánh: ${sub}`);
      }
      todo = (await findGaps(topic, [...sections.keys()])).filter((g) => !sections.has(g));
      if (todo.length === 0) break; // đủ phạm vi → dừng
      log(`[round ${rnd}] còn thiếu: ${JSON.stringify(todo)}`);
    }
    if (todo.length) console.warn(`CẢNH BÁO: hết số vòng mà vẫn còn nhánh thiếu: ${JSON.stringify(todo)}`);
    const body = [...sections].map(([k, v]) => `## ${k}\n${v}`).join("\n\n");
    return runAgent("Bạn là người viết báo cáo.", `Viết báo cáo tổng hợp về '${topic}' từ các phần sau, giữ nguyên nguồn:\n${body}`);
  }

  return { runAgent, coordinator };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(await proxyHub(httpChat()).coordinator(process.argv[2] ?? "Renewable energy technologies"));
}
