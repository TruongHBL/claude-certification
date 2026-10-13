#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Bài 1.1 – bản CLI: đọc stream-json của `claude -p` và in lại VÒNG LẶP AGENT từng lượt.
//
//   node --experimental-strip-types parse_loop.ts loop.jsonl [tools.log]
//
// Một lượt = một response của API (gom theo message.id). Lưu ý: stream-json có thể tách MỘT response
// thành NHIỀU dòng "assistant" (mỗi content block một dòng) cùng message.id, nên phải gom theo id,
// không đếm theo số dòng. stop_reason lấy từ dòng có giá trị khác null; nếu CLI không ghi thì
// SUY RA (có tool_use → tool_use, không có → end_turn) và đánh dấu "(suy ra)".

import { existsSync, readFileSync } from "node:fs";
import { readStream, type StreamEvent } from "../lib/cli_stream.ts";

const [path, toolLog] = process.argv.slice(2);
if (!path || !existsSync(path)) {
  console.error("Dùng: node --experimental-strip-types parse_loop.ts loop.jsonl [tools.log]");
  process.exit(1);
}

interface Turn {
  blocks: any[];
  stopReason: string | null;
  sr?: string;
}
const turns = new Map<string, Turn>(); // message.id → lượt (Map giữ thứ tự xuất hiện)
const results = new Map<string, { content: string; isError: boolean }>(); // tool_use_id → kết quả
let final: StreamEvent | undefined;
let init: StreamEvent | undefined;

for (const ev of readStream(path)) {
  if (ev.parent_tool_use_id != null) continue; // chỉ xem luồng chính (bài 1.1 không có subagent)
  switch (ev.type) {
    case "system":
      if (ev.subtype === "init") init ??= ev;
      break;
    case "assistant": {
      const msg = ev.message ?? {};
      const id = msg.id ?? `noid-${turns.size}`;
      if (!turns.has(id)) turns.set(id, { blocks: [], stopReason: null });
      const t = turns.get(id)!;
      t.blocks.push(...(msg.content ?? []));
      if (msg.stop_reason) t.stopReason = msg.stop_reason;
      break;
    }
    case "user": {
      const content = ev.message?.content;
      if (!Array.isArray(content)) break;
      for (const b of content) {
        if (b.type !== "tool_result") continue;
        const text = Array.isArray(b.content)
          ? b.content.flatMap((c: any) => (c.text != null ? [c.text] : [])).join(" ")
          : String(b.content ?? "");
        results.set(b.tool_use_id, { content: text, isError: !!b.is_error });
      }
      break;
    }
    case "result":
      final = ev;
      break;
  }
}

const short = (s: unknown, n = 110) => {
  const t = String(s ?? "").replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

if (init) console.log(`Tool khả dụng (system:init): ${(init.tools ?? []).join(", ")}`);
console.log();
let toolCalls = 0;
const unmatched: string[] = [];
const order = [...turns.keys()];
order.forEach((id, i) => {
  const t = turns.get(id)!;
  const uses = t.blocks.filter((b) => b.type === "tool_use");
  t.sr = t.stopReason ?? `${uses.length ? "tool_use" : "end_turn"} (suy ra)`;
  console.log(`Lượt ${i + 1} · ${id} · stop_reason=${t.sr}`);
  for (const b of t.blocks) {
    if (b.type === "text") {
      if (String(b.text ?? "").trim()) console.log(`  text     : ${short(b.text)}`);
    } else if (b.type === "thinking") {
      console.log(`  thinking : (${String(b.thinking ?? "").length} ký tự)`);
    } else if (b.type === "tool_use") {
      toolCalls++;
      console.log(`  tool_use : ${b.id} ${b.name} ${JSON.stringify(b.input)}`);
      const r = results.get(b.id);
      if (r) console.log(`    ↳ tool_result${r.isError ? " [is_error]" : ""} (${b.id}): ${short(r.content)}`);
      else {
        unmatched.push(b.id);
        console.log(`    ↳ (không thấy tool_result cho ${b.id})`);
      }
    }
  }
  console.log();
});

const lastSr = order.length ? turns.get(order.at(-1)!)!.sr : undefined;
console.log("== Tóm tắt");
console.log(`Số lượt API (gom theo message.id): ${order.length}`);
console.log(`Số tool_use: ${toolCalls}  ·  tool_result ghép được: ${toolCalls - unmatched.length}/${toolCalls}`);
if (toolLog && existsSync(toolLog)) {
  const n = readFileSync(toolLog, "utf8").split("\n").filter((l) => l.trim()).length;
  console.log(`MCP server ghi nhận: ${n} lần tools/call ${n === toolCalls ? "(khớp số tool_use)" : "(KHÔNG khớp số tool_use)"}`);
}
console.log(`stop_reason lượt cuối: ${lastSr ?? "(không có)"}`);
if (final) {
  console.log(
    `result: subtype=${final.subtype} · num_turns=${JSON.stringify(final.num_turns ?? null)} · ` +
      `total_cost_usd=${JSON.stringify(final.total_cost_usd ?? null)}`,
  );
  console.log(`Câu trả lời: ${short(final.result, 300)}`);
}

const checks: [string, boolean][] = [
  ["Mọi lượt trước lượt cuối đều dừng vì tool_use", order.slice(0, -1).every((id) => turns.get(id)!.sr!.startsWith("tool_use"))],
  ["Lượt cuối dừng vì end_turn", (lastSr ?? "").startsWith("end_turn")],
  ["Mọi tool_use đều có tool_result ghép theo tool_use_id", unmatched.length === 0],
  ["Có dùng tool (không tự trả lời ngay)", toolCalls > 0],
];
console.log();
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);

console.log(`
== Đối chiếu với vòng lặp tự viết (bai_1_1_agentic_loop.ts)
- Bản API: code của mình gọi Messages API, đọc stop_reason, chạy tool, nối tool_result, quyết định dừng.
- Bản CLI: Claude Code làm toàn bộ việc đó. Mỗi "Lượt" ở trên tương ứng một vòng \`for (i < MAX_ITERATIONS)\`
  của bản API; mỗi dòng ↳ tương ứng một phần tử \`results\` trong message user.
- KHÔNG làm được bằng CLI: tự đặt điều kiện dừng, tự xử lý stop_reason lạ (max_tokens, refusal),
  tự quyết MAX_ITERATIONS. Ở đây chỉ QUAN SÁT được vòng lặp của Claude Code.`);
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
