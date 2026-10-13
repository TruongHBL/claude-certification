// Bài 2.2 – in bảng cho run_llm.sh: mỗi prompt gọi tool nào, bao nhiêu lần, câu trả lời cuối.
// Dùng: node --experimental-strip-types report_llm.ts <results_llm> <prompt0> <prompt1> …
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readStream, resultEvent, toolUses } from "../lib/cli_stream.ts";

const [dirArg, ...prompts] = process.argv.slice(2);
for (const style of ["structured", "bad"]) {
  const dir = join(dirArg, style);
  if (!existsSync(dir)) continue;
  console.log(`== ${style}`);
  prompts.forEach((p, i) => {
    const f = join(dir, `p${i}.jsonl`);
    if (!existsSync(f)) return;
    const ev = readStream(f);
    const calls = toolUses(ev).map((t) => `${t.name.replace("mcp__support__", "")}(${JSON.stringify(t.input)})`);
    const final = resultEvent(ev);
    console.log(`  p${i}: ${p}`);
    console.log(`     ${calls.length} lần gọi: ${calls.join(" → ")}`);
    console.log(`     trả lời: ${String(final?.result ?? "").replace(/\s+/g, " ").slice(0, 160)}`);
  });
}
