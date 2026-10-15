// Bài 3.3 – sinh biến thể "gom hết vào root CLAUDE.md" từ demo-repo (bước 6: so token).
// variant-root/ = demo-repo nhưng KHÔNG có .claude/rules/; nội dung mọi rule (bỏ frontmatter) được nối vào
// cuối CLAUDE.md. Mã CANARY giữ nguyên, nên ở biến thể này mọi CANARY đều thấy được trong mọi phiên.
//
// Dùng: node --experimental-strip-types make_variant.ts [demo-repo] [variant-root]
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRules } from "./match_rules.ts";

export function buildVariantClaudeMd(repo: string): string {
  const base = readFileSync(join(repo, "CLAUDE.md"), "utf8").trimEnd();
  const sections = loadRules(repo).map(
    (r) => `<!-- gộp từ ${r.file}${r.fm.paths ? ` (paths: ${r.fm.paths.join(", ")})` : ""} -->\n${r.fm.body.trim()}`,
  );
  return [
    "<!-- FILE SINH TỰ ĐỘNG bởi make_variant.ts từ demo-repo. Đừng sửa tay. -->",
    base,
    ...sections,
  ].join("\n\n") + "\n";
}

export function makeVariant(repo: string, out: string): void {
  if (existsSync(out)) rmSync(out, { recursive: true });
  cpSync(repo, out, { recursive: true, filter: (src) => !src.includes(`${join(repo, ".claude")}`) });
  writeFileSync(join(out, "CLAUDE.md"), buildVariantClaudeMd(repo));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const here = new URL(".", import.meta.url).pathname;
  const repo = process.argv[2] ?? join(here, "demo-repo");
  const out = process.argv[3] ?? join(here, "variant-root");
  makeVariant(repo, out);
  console.log(`Đã sinh ${out} (CLAUDE.md ${readFileSync(join(out, "CLAUDE.md"), "utf8").length} ký tự, không có .claude/rules/)`);
}
