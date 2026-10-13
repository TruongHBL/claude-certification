// Test bài 1.3 bản không cần API key. KHÔNG gọi model.
//   THẬT : Agent SDK thật spawn binary, giao thức stream-json, hàm verify() của bài, script run_cli.sh.
//   GIẢ  : luồng coordinator/subagent trong test/bin/claude_sdk_fake.ts là kịch bản cố định.
// Chạy: node --experimental-strip-types --no-warnings test/run.test.ts   (cần node_modules ở gốc repo)
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, section, summary } from "../../lib/check.ts";

const ROOT = join(import.meta.dirname, "..");
const REPO = join(ROOT, "..");
if (!existsSync(join(REPO, "node_modules", "@anthropic-ai", "claude-agent-sdk"))) {
  console.error("Cần chạy `npm install` ở gốc repo trước (node_modules có @anthropic-ai/claude-agent-sdk)");
  process.exit(1);
}
const tmp = mkdtempSync(join(tmpdir(), "t13-"));
const log = join(tmp, "sdk.log");

// Lấy giá trị cờ CLI: SDK 0.3.293 truyền "--flag value", SDK 0.3.296 truyền "--flag=value" → đọc cả hai
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i >= 0) return argv[i + 1];
  return argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}
const hasFlag = (argv: string[], name: string) => argv.includes(name) || argv.some((a) => a.startsWith(`${name}=`));

section("Đầu-cuối run_cli.sh (Agent SDK THẬT → claude-sdk-fake)");
const env = { ...process.env, CLAUDE_BIN: join(ROOT, "test", "bin", "claude-sdk-fake"), FAKE_SDK_LOG: log, ANTHROPIC_API_KEY: "sk-dummy-phai-bi-unset" };
const r = spawnSync(join(ROOT, "run_cli.sh"), { env, encoding: "utf8" });
const o = (r.stdout ?? "") + (r.stderr ?? "");
check("run_cli.sh chạy xong, exit 0", r.status === 0, r.status === 0 ? "" : o.slice(-400));
const rows = existsSync(log)
  ? readFileSync(log, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, any>)
  : [];
const argv: string[] = rows.find((x) => x.argv)?.argv ?? [];
check("SDK spawn đúng binary trỏ bởi CLAUDE_BIN", rows.some((x) => String(x.self ?? "").endsWith("claude-sdk-fake")));
check("tiến trình con KHÔNG có ANTHROPIC_API_KEY (run_cli.sh đã unset)", rows.filter((x) => "has_api_key" in x).every((x) => !x.has_api_key));
const allowed = (flag(argv, "--allowedTools") ?? "").split(",");
check("--allowedTools có Agent (thiếu là không spawn được subagent)", allowed.includes("Agent"), allowed.join(","));
check("outputFormat json_schema → cờ --json-schema", hasFlag(argv, "--json-schema"));
check("--max-budget-usd 2 được truyền xuống CLI", flag(argv, "--max-budget-usd") === "2");
check(
  "SDK gửi đủ 3 AgentDefinition trong initialize",
  rows.some((x) => JSON.stringify([...(x.initialize?.agents ?? [])].sort()) === JSON.stringify(["doc-analyst", "synthesizer", "web-researcher"])),
);
check("verify(): phát hiện spawn song song từ stream thật của SDK", o.includes("Spawn song song 2 subagent nghiên cứu: CÓ"));
check("verify(): synthesizer nhận findings đủ metadata", o.includes("Findings gửi tới synthesizer: 2") && o.includes("Lỗi metadata: không"));
check("verify(): không có claim mồ côi", o.includes("Claim mồ côi: không"));

section("Test hàm thuần có sẵn (bai_1_3_test_stub.ts)");
const t = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "bai_1_3_test_stub.ts")], { encoding: "utf8" });
check("bai_1_3_test_stub.ts", t.status === 0, (t.stdout + t.stderr).trim().split("\n").pop() ?? "");

summary();
