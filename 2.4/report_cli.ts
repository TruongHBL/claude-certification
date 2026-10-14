// Bài 2.4 – đọc results_cli/<style>/q*.jsonl, in tool nào được gọi theo thứ tự và tổng theo nhóm
// (MCP / built-in / đọc resource), để so DESC=sparse với DESC=clear.
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readStream, toolUses, resultEvent } from "../lib/cli_stream.ts";

const results = process.argv[2] ?? "results_cli";
const kind = (name: string) =>
  name.startsWith("mcp__") ? "mcp" : /McpResource/.test(name) ? "resource" : "built-in";

for (const style of ["sparse", "clear"]) {
  const dir = join(results, style);
  if (!existsSync(dir)) continue;
  const total = { mcp: 0, "built-in": 0, resource: 0 } as Record<string, number>;
  let cost = 0;
  console.log(`\n== DESC=${style}`);
  for (const f of readdirSync(dir).filter((f) => /^q\d+\.jsonl$/.test(f)).sort()) {
    const ev = readStream(join(dir, f));
    const uses = toolUses(ev);
    for (const u of uses) total[kind(u.name)]!++;
    cost += Number(resultEvent(ev)?.total_cost_usd ?? 0);
    const seq = uses.map((u) => u.name.replace("mcp__crm-db__", "mcp:")).join(" → ") || "(không gọi tool)";
    console.log(`  ${f.replace(".jsonl", "")}: ${uses.length} lần gọi · ${seq}`);
  }
  console.log(`  Tổng: MCP ${total.mcp}, built-in ${total["built-in"]}, đọc resource ${total.resource} · chi phí $${cost.toFixed(4)}`);
}
