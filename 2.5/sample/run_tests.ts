// Chạy mọi file *.test.ts trong src/: node --experimental-strip-types run_tests.ts
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { registry } from "./test_harness.ts";

const src = join(import.meta.dirname, "src");
const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith(".test.ts")).sort();
for (const f of files) await import(pathToFileURL(join(src, f)).href);

let failed = 0;
for (const t of registry) {
  try {
    t.fn();
    console.log(`ok    ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${t.name}: ${(e as Error).message}`);
  }
}
console.log(`${registry.length - failed}/${registry.length} test đạt`);
process.exitCode = failed ? 1 : 0;
