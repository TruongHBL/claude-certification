// Bài 1.2 – Build Exercise: Hub-and-Spoke Research Coordinator.
//
// Coordinator (hub) phân rã chủ đề, giao việc cho 2 subagent (spoke): tìm kiếm và phân tích,
// gom kết quả, chạy vòng tinh chỉnh tìm nhánh còn thiếu rồi viết báo cáo cuối.
//
// Chạy:  export ANTHROPIC_API_KEY=...
//        node --experimental-strip-types bai_1_2_hub_and_spoke.ts ["chủ đề"]
// Không có API key: dùng bản CLI (./run_cli.sh).

import { pathToFileURL } from "node:url";
import { httpTransport, type Message, type Tool, type Transport } from "../lib/anthropic.ts";

const MODEL = "claude-sonnet-5-5";
// Server tool của Anthropic (chạy phía API, không cần mình thực thi). Không có input_schema
// như tool thường, nên ép kiểu khi đưa vào `tools`.
const WEB_SEARCH = { type: "web_search_20260209", name: "web_search", max_uses: 3 } as unknown as Tool;

export function hub(send: Transport, log: (s: string) => void = console.log) {
  // Mỗi lần gọi = context MỚI. Subagent chỉ biết những gì nằm trong `task`.
  async function runAgent(system: string, task: string, tools?: Tool[]): Promise<string> {
    const messages: Message[] = [{ role: "user", content: task }];
    for (;;) {
      const r = await send({ model: MODEL, max_tokens: 4000, system, messages, ...(tools ? { tools } : {}) });
      if (r.stop_reason === "pause_turn") {
        // server tool chạy chưa xong → gửi lại để chạy tiếp
        messages.push({ role: "assistant", content: r.content });
        continue;
      }
      // nối các block text (web search tách text quanh citation)
      return r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    }
  }

  async function askJson(system: string, task: string): Promise<string[]> {
    const text = await runAgent(system, `${task}\nChỉ trả về một JSON array các chuỗi, không giải thích.`);
    return JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as string[];
  }

  // ---------- Subagents (spoke) ----------
  const searchSubagent = (topic: string, sub: string) =>
    runAgent(
      "Bạn là subagent tìm kiếm thông tin.",
      `Bối cảnh: team đang viết báo cáo về '${topic}'.\n` +
        `Nhiệm vụ: tìm thông tin mới, đáng tin cậy về '${sub}'.\n` +
        `Ranh giới: CHỈ viết về '${sub}', không lấn sang nhánh khác.\n` +
        "Output: 5–8 gạch đầu dòng, mỗi dòng kèm URL nguồn.",
      [WEB_SEARCH],
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

  return { runAgent, askJson, decompose, findGaps, coordinator };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(await hub(httpTransport()).coordinator(process.argv[2] ?? "Renewable energy technologies"));
}
