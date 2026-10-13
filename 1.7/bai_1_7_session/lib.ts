// Helper cho run.sh (thay các đoạn `ruby -rjson -e …` cũ). Không gọi Claude.
//   result <stepN.json> <stepN.md>   ghi field "result" ra .md, in session_id / cost / turns / subtype
//   session-id <stepN.json>          in session_id
//   reads <transcript.jsonl> [skip]  liệt kê file đã Read (bỏ qua `skip` dòng đầu), vd "auth.rb, session.rb×2"
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [cmd, ...args] = process.argv.slice(2);
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, any>;

switch (cmd) {
  case "result": {
    const [json, md] = args as [string, string];
    const d = readJson(json);
    writeFileSync(md, String(d.result ?? ""));
    console.log(`  session_id=${d.session_id}  cost=$${Number(d.total_cost_usd ?? 0).toFixed(4)}  turns=${d.num_turns}  subtype=${d.subtype}`);
    break;
  }
  case "session-id":
    console.log(readJson(args[0]!).session_id);
    break;
  case "reads": {
    const [tr, skip = "0"] = args;
    if (!tr || !existsSync(tr)) {
      console.log(`(không tìm thấy transcript ${tr})`);
      break;
    }
    const files = readFileSync(tr, "utf8")
      .split("\n")
      .slice(Number(skip)) // giống wc -l: đếm theo dòng, kể cả trước khi lọc
      .filter((l) => l.length)
      .flatMap((l) => {
        let m: any;
        try {
          m = JSON.parse(l).message;
        } catch {
          return [];
        }
        const c = m?.content;
        if (!Array.isArray(c)) return [];
        return c
          .filter((b: any) => b?.type === "tool_use" && b.name === "Read")
          .map((b: any) => basename(String(b.input?.file_path ?? "")));
      });
    const tally = new Map<string, number>();
    for (const f of files) tally.set(f, (tally.get(f) ?? 0) + 1);
    console.log(files.length ? [...tally].map(([f, n]) => (n > 1 ? `${f}×${n}` : f)).join(", ") : "(không đọc file nào)");
    break;
  }
  default:
    console.error("Dùng: lib.ts result <json> <md> | session-id <json> | reads <transcript> [skip]");
    process.exit(2);
}
