// Test bài 2.5: codebase mẫu, refactor chuẩn, verify, bộ chấm chuỗi tool, run_cli.sh (với claude GIẢ).
//   node --experimental-strip-types --no-warnings test/run.test.ts
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { check, section, summary } from "../../lib/check.ts";
import { readStream, type StreamEvent } from "../../lib/cli_stream.ts";
import { applyEdit, nonUniqueMessage, REFERENCE_EDITS, RELATED_TESTS } from "../refactor_reference.ts";
import { verify } from "../verify.ts";
import { report, steps, grade, countFiles } from "../analyze_tools.ts";

const ROOT = join(import.meta.dirname, "..");
const SAMPLE = join(ROOT, "sample");
const TMP = mkdtempSync(join(tmpdir(), "bai25-"));
const copy = (name: string) => {
  const d = join(TMP, name);
  cpSync(SAMPLE, d, { recursive: true });
  return d;
};
const TOTAL = countFiles(SAMPLE);

section("Codebase mẫu");
{
  const d = copy("fresh");
  const r = verify(d);
  check("test của codebase mẫu đạt trước refactor", r.testsOk, r.testsOutput);
  check("verify phát hiện 11 lời gọi/import deprecated ban đầu", r.violations.length === 11, String(r.violations.length));
  check("ban đầu chưa caller nào dùng processOrder", r.callersMigrated.every((c) => !c.ok));
  check("bẫy barrel: grep tên gốc KHÔNG thấy consumer order_routes.ts",
    !readFileSync(join(d, "src/api/order_routes.ts"), "utf8").includes("processLegacyOrder"));
  check("bẫy Glob: có file tên chứa 'legacy' mà không gọi hàm",
    ["src/legacy/legacy_pricing.ts", "src/utils/legacy_dates.ts"].every((f) => !readFileSync(join(d, f), "utf8").includes("processLegacyOrder(")));
  check("bẫy false positive: CHANGELOG/docs/i18n nhắc tên hàm nhưng không phải lời gọi trong src",
    readFileSync(join(d, "CHANGELOG.md"), "utf8").includes("processLegacyOrder") && readFileSync(join(d, "src/i18n/messages.ts"), "utf8").includes("processLegacyOrder"));
  check("test liên quan tồn tại cạnh caller", RELATED_TESTS.every((f) => existsSync(join(d, f))));
  check("có test chỉ gọi qua module nguồn, không nhắc tên hàm",
    !readFileSync(join(d, "src/checkout/checkout_service.test.ts"), "utf8").includes("LegacyOrder"));
}

section("Mô phỏng Edit + refactor chuẩn");
{
  const d = copy("ref");
  const first = applyEdit(d, { file_path: "src/admin/bulk_reprocess.ts", old_string: "results.push(processLegacyOrder(id));", new_string: "x" });
  check("Edit old_string khớp 2 chỗ → lỗi non-unique", !first.ok && first.message === nonUniqueMessage(2), first.message);
  const nf = applyEdit(d, { file_path: "src/config.ts", old_string: "không-có", new_string: "x" });
  check("Edit không khớp → lỗi not found", !nf.ok && /not found/.test(nf.message));
  const d2 = copy("ref2");
  const errs = REFERENCE_EDITS.map((e) => applyEdit(d2, e)).filter((r) => !r.ok);
  check("refactor chuẩn: đúng 1 Edit lỗi (non-unique) rồi replace_all", errs.length === 1 && /Found 2 matches/.test(errs[0]!.message));
  const v = verify(d2);
  check("sau refactor chuẩn: test vẫn đạt", v.testsOk, v.testsOutput);
  check("sau refactor chuẩn: 0 lời gọi deprecated", v.violations.length === 0, v.violations.join("; "));
  check("sau refactor chuẩn: mọi caller dùng processOrder(…, { validate: true })", v.callersMigrated.every((c) => c.ok));
  check("legacy.ts và test của nó giữ nguyên",
    readFileSync(join(d2, "src/orders/legacy.ts"), "utf8") === readFileSync(join(SAMPLE, "src/orders/legacy.ts"), "utf8"));
}

section("Bộ chấm chuỗi tool (sự kiện dựng tay)");
{
  const ev = (name: string, input: Record<string, unknown>, result: string, isError = false, i = Math.random()): StreamEvent[] => [
    { type: "assistant", message: { content: [{ type: "tool_use", id: `t${i}`, name, input }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: `t${i}`, content: result, is_error: isError }] } },
  ];
  const W = "/w";
  const evs = [
    ...ev("Grep", { pattern: "processLegacyOrder" }, "…"),
    ...ev("Read", { file_path: `${W}/src/admin/bulk_reprocess.ts` }, "…"),
    ...ev("Edit", { file_path: `${W}/src/admin/bulk_reprocess.ts`, old_string: "a" }, nonUniqueMessage(2), true),
    ...ev("Read", { file_path: `${W}/src/admin/bulk_reprocess.ts` }, "…"),
    ...ev("Write", { file_path: `${W}/src/admin/bulk_reprocess.ts`, content: "…" }, "ok"),
  ];
  const st = steps(evs, W);
  check("đường dẫn tuyệt đối → tương đối theo thư mục làm việc", st[1]!.file === "src/admin/bulk_reprocess.ts");
  const g = grade(st, TOTAL);
  const by = (id: string) => g.find((c) => c.id === id)!;
  check("Edit non-unique rồi Read + Write → O1 ghi nhận 'Read + Write'", by("O1").ok === true && /Read \+ Write/.test(by("O1").detail), by("O1").detail);
  check("có Write → C7 FAIL", by("C7").ok === false);
  const bash = steps([...ev("Bash", { command: "grep -rn submitLegacyOrder src" }, "…"), ...ev("Bash", { command: "find src -name '*.test.ts'" }, "…")], W);
  check("Bash grep → tìm nội dung, Bash find → tìm đường dẫn", bash[0]!.kind === "content-search" && bash[1]!.kind === "path-search");
  const bashOther = steps(ev("Bash", { command: "cat src/config.ts" }, "…"), W);
  check("Bash khác (cat) → không tính là tìm kiếm", bashOther[0]!.kind === "other");
}

section("run_cli.sh đầu-cuối với claude GIẢ");
const FAKE = join(ROOT, "test/bin/claude");
const run = (name: string, env: Record<string, string>, cmd = "all") => {
  const work = join(TMP, `${name}-work`);
  const out = join(TMP, `${name}-out`);
  const argv = join(TMP, `${name}-argv.log`);
  const r = spawnSync(join(ROOT, "run_cli.sh"), [cmd], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_BIN: FAKE, WORK_DIR: work, OUT_DIR: out, FAKE_ARGV_LOG: argv, ...env },
  });
  const args: string[] = existsSync(argv) ? JSON.parse(readFileSync(argv, "utf8").trim().split("\n").pop()!) : [];
  return { r, work, out, args, events: readStream(join(out, "run.jsonl")) };
};
{
  const good = run("good", {});
  check("kịch bản đúng: run_cli.sh all thoát 0", good.r.status === 0, good.r.stderr.slice(0, 300));
  const { criteria } = report(good.events, good.work, TOTAL);
  check("kịch bản đúng: C1–C7 đều OK", criteria.filter((c) => c.id.startsWith("C")).every((c) => c.ok), JSON.stringify(criteria.filter((c) => !c.ok)));
  check("kịch bản đúng: O1 thấy non-unique → replace_all", /replace_all/.test(criteria.find((c) => c.id === "O1")!.detail));
  check("kịch bản đúng: output có 'KẾT LUẬN: refactor đạt'", /KẾT LUẬN: refactor đạt/.test(good.r.stdout));
  check("sample/ không bị sửa sau khi chạy", readFileSync(join(SAMPLE, "src/api/order_routes.ts"), "utf8").includes("submitLegacyOrder("));
  const a = good.args;
  const after = (f: string) => a[a.indexOf(f) + 1];
  check("cờ: --tools Read,Grep,Glob,Edit (không Bash/Write)", after("--tools") === "Read,Grep,Glob,Edit");
  const allowed = a.slice(a.indexOf("--allowedTools") + 1, a.indexOf("--permission-mode"));
  check("cờ: --allowedTools chỉ Read Grep Glob Edit", allowed.join(" ") === "Read Grep Glob Edit", allowed.join(" "));
  check("cờ: dontAsk + safe-mode + max-budget + stream-json + model sonnet",
    after("--permission-mode") === "dontAsk" && a.includes("--safe-mode") && after("--max-budget-usd") === "1" &&
      after("--output-format") === "stream-json" && after("--model") === "sonnet");
  check("prompt không gợi ý tên tool nào", !/\b(Grep|Glob|Read|Edit|Write|Bash)\b/.test(after("-p")!), after("-p"));

  const bad = run("bad", { FAKE_SCENARIO: "bad" });
  const rb = report(bad.events, bad.work, TOTAL).criteria;
  const failed = rb.filter((c) => c.ok === false).map((c) => c.id).join(",");
  check("kịch bản sai: bắt đủ C1–C7 FAIL", failed === "C1,C2,C3,C4,C5,C6,C7", failed);
  check("kịch bản sai: verify báo CHƯA đạt (sót barrel + wrapper)", bad.r.status !== 0 && /order_routes\.ts/.test(bad.r.stdout) && /apply\.ts/.test(bad.r.stdout));

  const w = run("write", { ALLOW_WRITE: "1" }, "run");
  check("ALLOW_WRITE=1 thêm Write vào --tools và --allowedTools",
    w.args[w.args.indexOf("--tools") + 1] === "Read,Grep,Glob,Edit,Write" && w.args.includes("Write"));

  const b = run("bash", { SEARCH: "bash" });
  check("SEARCH=bash: --tools Read,Edit,Bash", b.args[b.args.indexOf("--tools") + 1] === "Read,Edit,Bash");
  check("SEARCH=bash: Bash chỉ được grep/rg/find/ls", ["Bash(grep:*)", "Bash(rg:*)", "Bash(find:*)", "Bash(ls:*)"].every((x) => b.args.includes(x)) && !b.args.includes("Bash"));
  const rbash = report(b.events, b.work, TOTAL);
  check("SEARCH=bash: cảnh báo không có Grep/Glob riêng", /KHÔNG có tool Grep\/Glob riêng/.test(rbash.text));
  check("SEARCH=bash: grep/find qua Bash vẫn đạt C1–C6", rbash.criteria.filter((c) => /^C[1-6]$/.test(c.id)).every((c) => c.ok));
}

rmSync(TMP, { recursive: true, force: true });
summary();
