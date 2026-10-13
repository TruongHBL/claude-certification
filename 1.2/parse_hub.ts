#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Bài 1.2 – bản CLI: đọc stream-json của `claude -p` và kiểm tra cấu trúc HUB-AND-SPOKE.
//
//   node --experimental-strip-types parse_hub.ts hub.jsonl [tools.log]
//
// Cách nhận biết trong stream-json:
//   - Coordinator spawn subagent = block tool_use tên "Agent" (tên cũ "Task") ở luồng chính
//     (parent_tool_use_id = null). input có subagent_type, description, prompt.
//   - Sự kiện của subagent mang parent_tool_use_id = id của tool_use Agent đã spawn nó.
//   - Kết quả subagent trả về coordinator = tool_result có tool_use_id = id đó.

import { existsSync, readFileSync } from "node:fs";
import { readStream, type StreamEvent } from "../lib/cli_stream.ts";

const [path, toolLog] = process.argv.slice(2);
if (!path || !existsSync(path)) {
  console.error("Dùng: node --experimental-strip-types parse_hub.ts hub.jsonl [tools.log]");
  process.exit(1);
}
const SPAWN = new Set(["Agent", "Task"]);

interface Spawn {
  id: string;
  msgId: string | undefined;
  type: string;
  description: string;
  prompt: string;
}
interface Call {
  id: string;
  name: string;
  input: Record<string, any>;
}
const spawns: Spawn[] = [];
const byId = new Map<string, Spawn>();
const calls = new Map<string | null, Call[]>(); // parent_tool_use_id → tool_use trong luồng đó
const callsOf = (p: string | null) => calls.get(p) ?? [];
const returned = new Map<string, number>(); // spawn id → độ dài kết quả trả về coordinator
let final: StreamEvent | undefined;

for (const ev of readStream(path)) {
  const parent = ev.parent_tool_use_id ?? null;
  if (ev.type === "assistant") {
    const msg = ev.message ?? {};
    for (const b of msg.content ?? []) {
      if (b.type !== "tool_use") continue;
      if (!calls.has(parent)) calls.set(parent, []);
      calls.get(parent)!.push({ id: b.id, name: b.name, input: b.input ?? {} });
      if (parent !== null || !SPAWN.has(b.name)) continue;
      const s: Spawn = {
        id: b.id,
        msgId: msg.id,
        type: String(b.input?.subagent_type ?? ""),
        description: String(b.input?.description ?? ""),
        prompt: String(b.input?.prompt ?? ""),
      };
      spawns.push(s);
      byId.set(b.id, s);
    }
  } else if (ev.type === "user") {
    const content = ev.message?.content;
    if (parent !== null || !Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type !== "tool_result" || !byId.has(b.tool_use_id)) continue;
      const text = Array.isArray(b.content)
        ? b.content.flatMap((c: any) => (c.text != null ? [c.text] : [])).join(" ")
        : String(b.content ?? "");
      returned.set(b.tool_use_id, text.length);
    }
  } else if (ev.type === "result") {
    final = ev;
  }
}

const short = (s: unknown, n = 160) => {
  const t = String(s ?? "").replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const tally = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].map(([k, v]) => `${k}×${v}`).join(", ");
};

// Nhóm spawn theo message.id: cùng id = cùng một lượt của coordinator = chạy song song.
const groups = new Map<string | undefined, Spawn[]>();
for (const s of spawns) groups.set(s.msgId, [...(groups.get(s.msgId) ?? []), s]);
console.log(`== Prompt giao việc của coordinator (${spawns.length} lần spawn, ${groups.size} lượt)`);
let gi = 0;
for (const [mid, list] of groups) {
  console.log(`Lượt spawn ${++gi} (${mid ?? "không có id"}) · ${list.length} subagent${list.length > 1 ? " SONG SONG" : ""}`);
  for (const s of list) {
    const inner = callsOf(s.id);
    const ret = returned.get(s.id);
    console.log(`  [${s.type}] ${s.description}`);
    console.log(`     prompt: ${short(s.prompt)}`);
    console.log(
      `     → trong luồng: ${inner.length} tool call (${tally(inner.map((c) => c.name))})` +
        ` · trả về coordinator: ${ret !== undefined ? `${ret} ký tự` : "KHÔNG thấy tool_result"}`,
    );
  }
}

// Tool gọi trong luồng subagent mà KHÔNG phải spawn của coordinator (parent không phải spawn id).
const orphanParents = [...calls.keys()].filter((p): p is string => p !== null && !byId.has(p));
const nested = [...calls].filter(([p, l]) => p !== null && l.some((c) => SPAWN.has(c.name)));
const searchOutside = [...calls].flatMap(([p, l]) => {
  if (p && byId.get(p)?.type === "search-agent") return [];
  return l
    .filter((c) => c.name === "mcp__research__search")
    .map((c) => [p ? (byId.get(p)?.type ?? p) : "coordinator", c] as const);
});
const analysis = spawns.filter((s) => s.type === "analysis-agent");
const synth = spawns.filter((s) => s.type === "synthesis-agent");
const typeCount = (t: string) => spawns.filter((s) => s.type === t).length;

console.log();
console.log("== Tóm tắt");
console.log(`Spawn theo loại: ${tally(spawns.map((s) => s.type))}`);
console.log(`Tool call của chính coordinator: ${tally(callsOf(null).map((c) => c.name))}`);
if (toolLog && existsSync(toolLog)) {
  const n = readFileSync(toolLog, "utf8").split("\n").filter((l) => l.trim()).length;
  const inStream = [...calls.values()].flat().filter((c) => c.name === "mcp__research__search").length;
  console.log(`MCP server ghi nhận ${n} lần search · stream-json có ${inStream} tool_use search`);
}
if (final) {
  console.log(
    `result: subtype=${final.subtype} · num_turns=${JSON.stringify(final.num_turns ?? null)} · ` +
      `total_cost_usd=${JSON.stringify(final.total_cost_usd ?? null)}`,
  );
}

const checks: [string, boolean][] = [
  ["Mọi subagent đều do coordinator spawn (Agent ở luồng chính)", orphanParents.length === 0 && spawns.length > 0],
  ["Subagent không spawn/gọi subagent khác", nested.length === 0],
  ["search chỉ chạy trong search-agent (coordinator và subagent khác không tự tìm)", searchOutside.length === 0],
  ["Coordinator spawn ≥5 search-agent (phân rã đủ rộng)", typeCount("search-agent") >= 5],
  ["Có lượt spawn ≥2 subagent song song", [...groups.values()].some((l) => l.length >= 2)],
  ["Prompt của analysis-agent có dán kết quả tìm kiếm kèm URL", analysis.length > 0 && analysis.every((s) => s.prompt.includes("http"))],
  ["synthesis-agent được spawn sau cùng", synth.length > 0 && spawns.at(-1)!.type === "synthesis-agent"],
  ["Mọi subagent đều trả kết quả về coordinator (tool_result)", spawns.every((s) => returned.has(s.id))],
];
console.log();
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
for (const [p, l] of nested) {
  const who = byId.get(p!)?.type ?? p;
  console.log(`  ↳ vi phạm: ${who} gọi ${l.filter((c) => SPAWN.has(c.name)).map((c) => c.input.subagent_type).join(", ")}`);
}
for (const [who, c] of searchOutside) console.log(`  ↳ vi phạm: ${who} tự gọi search ${JSON.stringify(c.input)}`);
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
