// CLAUDE GIẢ cho test bài 2.5. KHÔNG gọi model. Chạy trong thư mục làm việc (cwd), phát stream-json
// theo kịch bản cố định và THỰC SỰ áp thay đổi lên file (Edit mô phỏng đúng luật old_string duy nhất):
//   FAKE_SCENARIO=good (mặc định): Grep → Read → Grep tên mới → Glob test → Read caller → Edit (có 1 lần non-unique)
//   FAKE_SCENARIO=bad:             Glob tìm caller theo tên file → Read toàn bộ → Write cả file, bỏ sót barrel/wrapper
// Nếu --tools không có Grep/Glob mà có Bash: tìm kiếm phát dưới dạng lệnh Bash grep/find.
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyEdit, REFERENCE_EDITS } from "../refactor_reference.ts";

const args = process.argv.slice(2);
if (process.env.FAKE_ARGV_LOG) appendFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify(args) + "\n");
const cwd = process.cwd();
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const tools = (opt("--tools") ?? "Read,Grep,Glob,Edit").split(/[,\s]+/).filter(Boolean);
const bashSearch = !tools.includes("Grep") && tools.includes("Bash");
const scenario = process.env.FAKE_SCENARIO ?? "good";

const out = (o: unknown) => console.log(JSON.stringify(o));
const allFiles = (readdirSync(cwd, { recursive: true, withFileTypes: true }) as any[])
  .filter((d) => d.isFile())
  .map((d) => join(d.parentPath ?? d.path, d.name).slice(cwd.length + 1))
  .sort();

let n = 0;
const use = (name: string, input: Record<string, unknown>, run: () => { text: string; isError?: boolean }) => {
  const id = `toolu_${++n}`;
  out({ type: "assistant", message: { id: `msg_${n}`, content: [{ type: "tool_use", id, name, input }] } });
  const r = run();
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: r.text, ...(r.isError ? { is_error: true } : {}) }] } });
};
const grepText = (pat: string) =>
  allFiles
    .flatMap((f) =>
      readFileSync(join(cwd, f), "utf8")
        .split("\n")
        .flatMap((l, i) => (l.includes(pat) ? [`${f}:${i + 1}:${l}`] : [])),
    )
    .join("\n") || "No matches found";
const grep = (pat: string) =>
  bashSearch
    ? use("Bash", { command: `grep -rn "${pat}" src docs` }, () => ({ text: grepText(pat) }))
    : use("Grep", { pattern: pat, output_mode: "content", "-n": true }, () => ({ text: grepText(pat) }));
const glob = (pat: RegExp, shown: string) =>
  bashSearch
    ? use("Bash", { command: `find src -name '${shown}'` }, () => ({ text: allFiles.filter((f) => pat.test(f)).join("\n") }))
    : use("Glob", { pattern: `**/${shown}` }, () => ({ text: allFiles.filter((f) => pat.test(f)).join("\n") || "No files found" }));
const read = (f: string) => use("Read", { file_path: join(cwd, f) }, () => ({ text: readFileSync(join(cwd, f), "utf8") }));

out({ type: "system", subtype: "init", session_id: "fake-session", tools, model: opt("--model") ?? "sonnet" });

if (scenario === "good") {
  grep("processLegacyOrder");
  read("src/orders/legacy.ts");
  read("src/utils/index.ts");
  grep("submitLegacyOrder");
  read("src/orders/apply.ts");
  grep("applyLegacyOrder");
  glob(/\.test\.ts$/, "*.test.ts");
  for (const f of ["src/checkout/checkout_service.ts", "src/crm/customer_reorder.ts", "src/admin/bulk_reprocess.ts", "src/api/order_routes.ts"]) read(f);
  for (const e of REFERENCE_EDITS) {
    use("Edit", { ...e, file_path: join(cwd, e.file_path) }, () => {
      const r = applyEdit(cwd, e);
      return { text: r.message, isError: !r.ok };
    });
  }
} else {
  // Sai: Glob theo tên file chứa "legacy" để tìm caller (Glob không nhìn nội dung) rồi đọc hết mọi file.
  glob(/legacy/i, "*legacy*");
  for (const f of allFiles) read(f);
  // Write lại cả file cho 3 caller trực tiếp; bỏ sót consumer qua barrel và wrapper.
  for (const f of ["src/checkout/checkout_service.ts", "src/crm/customer_reorder.ts", "src/admin/bulk_reprocess.ts"]) {
    const copy = join(cwd, f);
    let text = readFileSync(copy, "utf8");
    for (const e of REFERENCE_EDITS.filter((x) => x.file_path === f)) text = text.split(e.old_string).join(e.new_string);
    use("Write", { file_path: copy, content: text }, () => (writeFileSync(copy, text), { text: `File created successfully at: ${copy}` }));
  }
}

out({ type: "assistant", message: { id: `msg_${++n}`, content: [{ type: "text", text: "(GIẢ) Đã chuyển các lời gọi sang processOrder." }], stop_reason: "end_turn" } });
out({ type: "result", subtype: "success", session_id: "fake-session", num_turns: n, total_cost_usd: 0, result: "(GIẢ) xong" });
