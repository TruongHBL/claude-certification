// Đọc stream-json của `claude -p` (bài 2.5) → in chuỗi tool theo thứ tự và chấm theo tiêu chí của đề.
//   node --experimental-strip-types analyze_tools.ts <run.jsonl> [thư-mục-làm-việc]
//
// Bản Claude Code có thể không có tool Grep/Glob riêng (tìm kiếm qua Bash + grep/find), nên lệnh Bash
// grep/rg/ugrep được tính là "tìm nội dung", find/fd/ls là "tìm đường dẫn".
import { readdirSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { readStream, resultEvent, type StreamEvent } from "../lib/cli_stream.ts";
import { CALLER_GROUPS } from "./refactor_reference.ts";

export type Kind = "content-search" | "path-search" | "read" | "edit" | "write" | "other";

export interface Step {
  n: number;
  tool: string;
  kind: Kind;
  summary: string; // pattern / đường dẫn rút gọn
  file?: string; // tương đối so với thư mục làm việc
  isError: boolean;
  resultText: string;
  input: Record<string, any>;
}

export interface Criterion {
  id: string;
  label: string;
  ok: boolean | null; // null = không áp dụng / chỉ quan sát
  detail: string;
}

const NON_UNIQUE = /Found \d+ matches of the string to replace|replace_all is false|more context to uniquely/i;

function classify(name: string, input: Record<string, any>): { kind: Kind; summary: string } {
  if (name === "Grep") return { kind: "content-search", summary: `${input.pattern}${input.glob ? ` (glob ${input.glob})` : ""}` };
  if (name === "Glob") return { kind: "path-search", summary: String(input.pattern) };
  if (name === "Read") return { kind: "read", summary: String(input.file_path) };
  if (name === "Edit") return { kind: "edit", summary: String(input.file_path) };
  if (name === "Write") return { kind: "write", summary: String(input.file_path) };
  if (name === "Bash") {
    const cmd = String(input.command ?? "").trim();
    if (/^(grep|rg|ugrep|git\s+grep)\b/.test(cmd)) return { kind: "content-search", summary: `$ ${cmd}` };
    if (/^(find|fd|ls)\b/.test(cmd)) return { kind: "path-search", summary: `$ ${cmd}` };
    return { kind: "other", summary: `$ ${cmd}` };
  }
  return { kind: "other", summary: JSON.stringify(input).slice(0, 80) };
}

const textOf = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => b?.text ?? "").join("\n") : JSON.stringify(c ?? "");

export function steps(events: StreamEvent[], workDir: string): Step[] {
  const results = new Map<string, { isError: boolean; text: string }>();
  for (const e of events)
    if (e.type === "user" && Array.isArray(e.message?.content))
      for (const b of e.message!.content)
        if (b.type === "tool_result") results.set(b.tool_use_id, { isError: b.is_error === true, text: textOf(b.content) });

  const out: Step[] = [];
  for (const e of events) {
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message!.content) {
      if (b.type !== "tool_use") continue;
      const { kind, summary } = classify(b.name, b.input ?? {});
      const r = results.get(b.id) ?? { isError: false, text: "" };
      const fp = b.input?.file_path as string | undefined;
      const file = fp ? (isAbsolute(fp) ? relative(workDir, fp) : fp.replace(/^\.\//, "")) : undefined;
      out.push({ n: out.length + 1, tool: b.name, kind, summary, file, isError: r.isError, resultText: r.text, input: b.input ?? {} });
    }
  }
  return out;
}

export function countFiles(dir: string): number {
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as any[]).filter((d) => d.isFile()).length;
}

export function grade(st: Step[], totalFiles: number): Criterion[] {
  const searches = st.filter((s) => s.kind === "content-search" || s.kind === "path-search");
  const first = searches[0];
  const readsBeforeFirst = first ? st.filter((s) => s.kind === "read" && s.n < first.n).length : st.filter((s) => s.kind === "read").length;
  const readFiles = new Set(st.filter((s) => s.kind === "read" && s.file).map((s) => s.file!));
  const content = st.filter((s) => s.kind === "content-search");
  const editedOk = new Set(st.filter((s) => s.kind === "edit" && !s.isError && s.file).map((s) => s.file!));
  const missing = CALLER_GROUPS.filter((g) => !g.some((f) => editedOk.has(f)));
  const writes = st.filter((s) => s.kind === "write");

  // Edit lỗi non-unique rồi thử lại thành công trên cùng file
  const nonUnique = st.filter((s) => s.kind === "edit" && s.isError && NON_UNIQUE.test(s.resultText));
  const recovered = nonUnique.map((err) => {
    const retry = st.find((s) => s.kind === "edit" && !s.isError && s.file === err.file && s.n > err.n);
    const how = !retry
      ? "chưa thử lại thành công"
      : retry.input.replace_all
        ? "thử lại bằng replace_all: true"
        : String(retry.input.old_string ?? "").length > String(err.input.old_string ?? "").length
          ? "thử lại với old_string dài hơn"
          : "thử lại bằng Edit khác";
    return { err, retry, how };
  });
  const readThenWrite = nonUnique.some((err) => st.some((s) => s.kind === "write" && s.file === err.file && s.n > err.n));

  return [
    {
      id: "C1",
      label: "Tìm kiếm đầu tiên là tìm NỘI DUNG (Grep), không mở đầu bằng Glob hay đọc hàng loạt",
      ok: !!first && first.kind === "content-search" && readsBeforeFirst <= 2,
      detail: first ? `bước ${first.n}: ${first.tool} ${first.summary}; ${readsBeforeFirst} lần Read trước đó` : "không có lần tìm kiếm nào",
    },
    {
      id: "C2",
      label: "Khám phá tăng dần: số file đã Read ≤ 50% tổng số file",
      ok: readFiles.size <= totalFiles * 0.5,
      detail: `${readFiles.size}/${totalFiles} file`,
    },
    {
      id: "C3",
      label: "Lần theo barrel đổi tên: có tìm nội dung 'submitLegacyOrder'",
      ok: content.some((s) => /submitLegacyOrder/.test(s.summary)),
      detail: content.filter((s) => /submitLegacyOrder/.test(s.summary)).map((s) => `bước ${s.n}`).join(", ") || "không thấy",
    },
    {
      id: "C4",
      label: "Lần theo wrapper: có tìm nội dung 'applyLegacyOrder'",
      ok: content.some((s) => /applyLegacyOrder/.test(s.summary)),
      detail: content.filter((s) => /applyLegacyOrder/.test(s.summary)).map((s) => `bước ${s.n}`).join(", ") || "không thấy",
    },
    {
      id: "C5",
      label: "Tìm file test theo ĐƯỜNG DẪN (Glob *.test.*)",
      ok: st.some((s) => s.kind === "path-search" && /test/.test(s.summary)),
      detail: st.filter((s) => s.kind === "path-search").map((s) => `bước ${s.n}: ${s.summary}`).join("; ") || "không có Glob",
    },
    {
      id: "C6",
      label: "Edit thành công ở mọi caller (trực tiếp, wrapper, barrel)",
      ok: missing.length === 0,
      detail: missing.length ? `thiếu: ${missing.map((g) => g.join(" | ")).join(", ")}` : `${editedOk.size} file đã Edit`,
    },
    {
      id: "C7",
      label: "Không dùng Write (Edit là tool sửa mặc định)",
      ok: writes.length === 0,
      detail: writes.length ? writes.map((s) => `bước ${s.n}: ${s.file}`).join(", ") : "0 lần Write",
    },
    {
      id: "O1",
      label: "Quan sát: Edit báo non-unique match rồi xử lý",
      ok: nonUnique.length === 0 ? null : recovered.every((r) => r.retry) || readThenWrite,
      detail:
        nonUnique.length === 0
          ? "không xảy ra (Claude chọn old_string đủ dài ngay từ đầu, hoặc không đụng tới chỗ trùng)"
          : recovered.map((r) => `bước ${r.err.n} lỗi ở ${r.err.file} → ${r.retry ? `bước ${r.retry.n}: ` : ""}${r.how}`).join("; ") +
            (readThenWrite ? "; có dùng Read + Write" : ""),
    },
  ];
}

export function report(events: StreamEvent[], workDir: string, totalFiles: number): { text: string; criteria: Criterion[] } {
  const st = steps(events, workDir);
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const tools: string[] = init?.tools ?? [];
  const lines: string[] = [];
  if (init) {
    lines.push(`Tool có trong phiên: ${tools.join(", ") || "(không có)"}`);
    if (!tools.includes("Grep") || !tools.includes("Glob"))
      lines.push("⚠ Phiên này KHÔNG có tool Grep/Glob riêng: tìm kiếm phải đi qua Bash (lệnh grep/find được tính tương đương).");
  }
  lines.push("", "Chuỗi tool:");
  for (const s of st) lines.push(`  ${String(s.n).padStart(2)}. ${s.tool.padEnd(5)} ${(s.file ?? s.summary).slice(0, 90)}${s.isError ? "  ✗ " + s.resultText.slice(0, 70) : ""}`);
  const count = st.reduce<Record<string, number>>((a, s) => ((a[s.tool] = (a[s.tool] ?? 0) + 1), a), {});
  lines.push("", `Đếm: ${Object.entries(count).map(([k, v]) => `${k}×${v}`).join(", ") || "(không có tool nào)"}`);
  const criteria = grade(st, totalFiles);
  lines.push("", "Tiêu chí:");
  for (const c of criteria) lines.push(`  ${c.ok === null ? "--  " : c.ok ? "OK  " : "FAIL"} ${c.id} ${c.label}\n         ${c.detail}`);
  const res = resultEvent(events);
  if (res) lines.push("", `Kết thúc: subtype=${res.subtype}, turns=${res.num_turns}, cost=$${Number(res.total_cost_usd ?? 0).toFixed(4)}`);
  return { text: lines.join("\n"), criteria };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [jsonl, dir = join(import.meta.dirname, ".work")] = process.argv.slice(2);
  if (!jsonl) {
    console.error("Dùng: analyze_tools.ts <run.jsonl> [thư-mục-làm-việc]");
    process.exit(2);
  }
  const { text, criteria } = report(readStream(jsonl), dir, countFiles(join(import.meta.dirname, "sample")));
  console.log(text);
  process.exitCode = criteria.every((c) => c.ok !== false) ? 0 : 1;
}
