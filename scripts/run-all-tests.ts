// Chạy mọi file test/*.test.ts trong các folder bài tập, in tổng kết.
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dirname, "..");
const lessons = readdirSync(root).filter((d) => /^\d\.\d$/.test(d)).sort();
let failed = 0;
for (const lesson of lessons) {
  const dir = join(root, lesson, "test");
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".test.ts")).sort()) {
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(dir, f)], {
      cwd: join(root, lesson),
      encoding: "utf8",
    });
    const last = (r.stdout.trim().split("\n").pop() ?? "").trim();
    console.log(`${r.status === 0 ? "✓" : "✗"} ${lesson}/test/${f}: ${last}`);
    if (r.status !== 0) failed++;
  }
}
process.exitCode = failed ? 1 : 0;
