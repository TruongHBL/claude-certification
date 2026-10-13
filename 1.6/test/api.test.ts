// Test bản Messages API bài 1.6 bằng transport GIẢ (không cần API key, không gọi model).
// LƯU Ý: dilution của single-pass là GIẢ LẬP (transport cố tình review nông dần theo thứ tự file)
// để kiểm thử pipeline và bộ chấm điểm. Không nói gì về hành vi thật của Claude.
// Chạy: node --experimental-strip-types test/api.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MessagesResponse, Transport } from "../../lib/anthropic.ts";
import { check, summary } from "../../lib/check.ts";
import { SAMPLE_DIR, compare, loadFiles, multiPass, singlePass } from "../bai_1_6_multipass_review.ts";

interface Bug { scope: string; file: string; files: string[]; line: number; severity: string; type: string; description: string }
const KEY = (JSON.parse(readFileSync(join(SAMPLE_DIR, "ANSWER_KEY.json"), "utf8")) as { bugs: Bug[] }).bugs;
const LONG = " Ảnh hưởng: dữ liệu sai hoặc crash khi chạy thật; cách sửa: xem mô tả, thêm test cho nhánh này.";
const CALLS: string[] = [];
const issue = (b: Bug, long: boolean) => ({ line: b.line, severity: b.severity, type: b.type, description: b.description + (long ? LONG : "") });
const heads = (text: string) => [...text.matchAll(/^=== (\S+) ===$/gm)].map((m) => m[1]);

const handlers: Record<string, (text: string) => Record<string, unknown>> = {
  // single-pass: GIẢ LẬP suy giảm độ sâu theo thứ tự file
  report_review(text) {
    const hs = heads(text);
    if (hs.length !== 12) throw new Error("single-pass phải chứa đủ 12 file");
    const per = KEY.filter((b) => b.scope === "per_file");
    const files = hs.map((f, i) => {
      const bugs = per.filter((b) => b.file === f);
      const issues =
        i < 5 ? bugs.map((b) => issue(b, true)) // file 01–05: kỹ
        : i < 9 ? bugs.map((b) => issue(b, false)) // 06–09: vừa phải
        : f === "10_search.js" ? [{ line: 5, severity: "low", type: "other", description: "Nên đổi tên hằng." }]
        : []; // 11, 12: bỏ sót
      return { file: f, issues };
    });
    return { files, cross_file_issues: [] };
  },
  report_file_review(text) {
    const hs = heads(text);
    if (hs.length !== 1) throw new Error(`per-file pass chỉ được chứa 1 file, thấy ${hs}`);
    const f = hs[0];
    const code = text.split("\n").slice(1).map((l) => l.replace(/^\s*\d+\| /, "")).join("\n");
    const bugs = KEY.filter((b) => b.scope === "per_file" && b.file === f);
    const exports = [...code.matchAll(/export (?:async )?function (\w+)\(([^)]*)\)/g)].map(([, n, a]) => ({
      name: n, signature: `${n}(${a})`, returns: n === "fetchMatching" ? "{ id, user_id, title, budget }" : "xem code",
    }));
    const imported = [...code.matchAll(/import \{([^}]+)\} from "\.\/([^"]+)"/g)].flatMap(([, ns, from]) =>
      ns.split(",").map((n) => [n.trim(), from] as const));
    const importsUsed = imported.flatMap(([n, from]) => {
      const call = code.split("\n").find((l) => new RegExp(`\\b${n}\\(`).test(l) && !l.startsWith("import"));
      if (!call) return [];
      const fields = n === "fetchMatching" ? [...new Set([...code.matchAll(/matching\.(\w+)/g)].map((m) => m[1]))] : [];
      return [{ from, name: n, call: call.trim(), fields_used: fields }];
    });
    return { file: "ten-sai-model-tu-dat.js", issues: bugs.map((b) => issue(b, true)), exports, imports_used: importsUsed, summary: `Tóm tắt ${f}.` };
  },
  report_integration(text) {
    if (text.includes("export async function") || /^\s*\d+\| /m.test(text)) throw new Error("integration không được nhận lại code");
    for (const s of ["addFavorite(req.user.id", "user_id", "userId"]) if (!text.includes(s)) throw new Error(`thiếu thông tin ${s}`);
    return {
      cross_file_issues: KEY.filter((b) => b.scope === "cross_file").map((b) => ({ files: b.files, severity: b.severity, type: b.type, description: b.description })),
    };
  },
};

let n = 0;
const fakeTransport: Transport = async (req) => {
  const tc = req.tool_choice;
  if (tc?.type !== "tool" || JSON.stringify(req.tools?.map((t) => t.name)) !== JSON.stringify([tc.name])) throw new Error("phải ép tool");
  CALLS.push(tc.name);
  const input = handlers[tc.name](String(req.messages[0].content));
  return { id: `msg_${n}`, role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: `t${n++}`, name: tc.name, input }] } satisfies MessagesResponse;
};

console.log("LƯU Ý: Claude ở đây là stub. Dilution của single-pass là GIẢ LẬP để kiểm thử pipeline và bộ chấm điểm.\n");
const files = loadFiles();
check("đọc được 12 file mẫu", files.length === 12);
const single = await singlePass(files, fakeTransport);
const multi = await multiPass(files, fakeTransport);
check("single-pass: đúng 1 lần gọi API cho 12 file", CALLS.filter((c) => c === "report_review").length === 1);
check("multi-pass: 12 pass per-file rồi 1 pass integration", CALLS.filter((c) => c === "report_file_review").length === 12 && CALLS.at(-1) === "report_integration");
check("tên file lấy từ code, không theo tên model tự đặt", JSON.stringify(multi.files.map((f) => f.file)) === JSON.stringify(files.map(([f]) => f)));
console.log();
const rep = compare(single, multi);
console.log();
check("multi: 8/8 lỗi trong file, 2/2 lỗi chéo file", rep.multi.per_file_found.length === 8 && rep.multi.cross_file_found.length === 2);
check("single: bỏ sót lỗi ở các file cuối", rep.single.per_file_found.length < 8);
check("đoạn y hệt 03/11: single không nhất quán, multi nhất quán", !rep.identical_code_03_11.single.consistent && rep.identical_code_03_11.multi.consistent);
check("C1, C2 chỉ integration pass bắt được", JSON.stringify(rep.cross_file_only_by_integration) === '["C1","C2"]');
summary();
