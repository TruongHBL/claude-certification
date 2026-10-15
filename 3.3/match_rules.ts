// Bài 3.3 – mô hình tĩnh: sửa/đọc file nào thì rule nào trong .claude/rules/ được nạp, và tốn bao nhiêu token.
//
// Theo tài liệu memory của Claude Code (code.claude.com/docs/en/memory, mục "Path-specific rules"):
//   - rule KHÔNG có `paths` → nạp lúc khởi động, mọi phiên;
//   - rule có `paths` → nạp khi Claude dùng Read/Write/Edit (hoặc `cat`/`head` một file) trên file khớp glob;
//   - `paths` nhận YAML list hoặc chuỗi phân tách bằng dấu phẩy; hỗ trợ brace `{ts,tsx}`;
//   - frontmatter không parse được → bỏ frontmatter, rule nạp như KHÔNG có `paths` (tức là mọi phiên);
//   - `paths` là field DUY NHẤT được đọc, field khác bị bỏ qua.
// Glob tính từ gốc project (vd `*.md` chỉ khớp file ở gốc).
//
// Dùng: node --experimental-strip-types match_rules.ts [demo-repo] [variant-root]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const CANARY_RE = /CANARY-[A-Z0-9-]+/g;

// ---------- glob ----------

/** Mở brace `{a,b}` thành nhiều pattern (lồng nhau được). */
export function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open < 0) return [pattern];
  let depth = 0;
  for (let i = open; i < pattern.length; i++) {
    if (pattern[i] === "{") depth++;
    else if (pattern[i] === "}" && --depth === 0) {
      const inner = pattern.slice(open + 1, i);
      const parts: string[] = [];
      let d = 0;
      let start = 0;
      for (let j = 0; j < inner.length; j++) {
        if (inner[j] === "{") d++;
        else if (inner[j] === "}") d--;
        else if (inner[j] === "," && d === 0) {
          parts.push(inner.slice(start, j));
          start = j + 1;
        }
      }
      parts.push(inner.slice(start));
      const head = pattern.slice(0, open);
      const tail = pattern.slice(i + 1);
      return parts.flatMap((p) => expandBraces(head + p + tail));
    }
  }
  return [pattern]; // brace không đóng: giữ nguyên, khớp chữ
}

/** Chuyển một glob (đã mở brace) thành RegExp. Hỗ trợ `**`, `*`, `?`, `[abc]`. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const atStart = i === 0 || glob[i - 1] === "/";
        const atEnd = i + 2 === glob.length || glob[i + 2] === "/";
        if (atStart && atEnd) {
          // `**/` = 0 hoặc nhiều thư mục; `**` ở cuối = mọi thứ còn lại
          if (glob[i + 2] === "/") {
            re += "(?:[^/]+/)*";
            i += 2;
          } else {
            re += ".*";
            i += 1;
          }
          continue;
        }
        re += "[^/]*";
        i += 1;
        continue;
      }
      re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const close = glob.indexOf("]", i + 1);
      if (close < 0) return /(?!)/; // `[` không đóng: pattern không hợp lệ, không khớp gì (như tài liệu)
      re += "[" + glob.slice(i + 1, close).replace(/\\/g, "\\\\") + "]";
      i = close;
    } else if (c === "\\" && i + 1 < glob.length) {
      re += "\\" + glob[++i];
    } else re += c.replace(/[.+^${}()|]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function matchGlob(file: string, pattern: string): boolean {
  const f = file.split(sep).join("/");
  return expandBraces(pattern).some((p) => globToRegExp(p).test(f));
}

// ---------- frontmatter ----------

export interface Frontmatter {
  paths: string[] | null; // null = không có paths → nạp mọi phiên
  body: string;
  error?: string; // frontmatter hỏng → bị bỏ, rule nạp mọi phiên
  ignoredFields: string[];
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");

export function parseFrontmatter(text: string): Frontmatter {
  if (!text.startsWith("---\n")) return { paths: null, body: text, ignoredFields: [] };
  const end = text.indexOf("\n---", 4);
  if (end < 0) return { paths: null, body: text, error: "thiếu dòng `---` đóng frontmatter", ignoredFields: [] };
  const yaml = text.slice(4, end).split("\n");
  const body = text.slice(text.indexOf("\n", end + 1) + 1);
  let paths: string[] | null = null;
  const ignored: string[] = [];
  for (let i = 0; i < yaml.length; i++) {
    const line = yaml[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) return { paths: null, body, error: `dòng YAML không hợp lệ: "${line}"`, ignoredFields: [] };
    const [, key, rest] = m;
    if (key !== "paths") {
      ignored.push(key);
      continue;
    }
    if (rest.startsWith("[")) {
      if (!rest.endsWith("]")) return { paths: null, body, error: "mảng `paths: [...]` không đóng", ignoredFields: [] };
      paths = rest.slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else if (rest.trim()) {
      paths = rest.split(",").map(unquote).filter(Boolean); // chuỗi phân tách bằng dấu phẩy
    } else {
      paths = [];
      while (i + 1 < yaml.length && /^\s+-\s/.test(yaml[i + 1])) paths.push(unquote(yaml[++i].replace(/^\s+-\s/, "")));
      if (!paths.length) return { paths: null, body, error: "`paths:` không có giá trị", ignoredFields: [] };
    }
  }
  return { paths, body, ignoredFields: ignored };
}

// ---------- repo ----------

export interface Rule {
  file: string; // đường dẫn tương đối từ gốc repo
  fm: Frontmatter;
  chars: number; // độ dài phần được đưa vào context (đã bỏ frontmatter)
  canaries: string[];
}

export function listFiles(root: string, dir = root): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === ".git" || name === "node_modules" || name === ".claude") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(root, p));
    else out.push(relative(root, p).split(sep).join("/"));
  }
  return out;
}

export function loadRules(repo: string): Rule[] {
  const dir = join(repo, ".claude", "rules");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const fm = parseFrontmatter(readFileSync(join(dir, f), "utf8"));
      return { file: `.claude/rules/${f}`, fm, chars: fm.body.length, canaries: fm.body.match(CANARY_RE) ?? [] };
    });
}

export interface Loaded {
  source: string;
  reason: "luôn nạp" | "khớp paths";
  chars: number;
  canaries: string[];
}

/** Những gì nằm trong context khi Claude đã Read/Edit các file `touched` (đường dẫn tương đối). */
export function loadedFor(repo: string, touched: string[]): Loaded[] {
  const out: Loaded[] = [];
  const claudeMd = join(repo, "CLAUDE.md");
  if (existsSync(claudeMd)) {
    const t = readFileSync(claudeMd, "utf8");
    out.push({ source: "CLAUDE.md", reason: "luôn nạp", chars: t.length, canaries: t.match(CANARY_RE) ?? [] });
  }
  for (const r of loadRules(repo)) {
    if (r.fm.paths === null) out.push({ source: r.file, reason: "luôn nạp", chars: r.chars, canaries: r.canaries });
    else if (touched.some((f) => r.fm.paths!.some((p) => matchGlob(f, p))))
      out.push({ source: r.file, reason: "khớp paths", chars: r.chars, canaries: r.canaries });
  }
  return out;
}

/** Mọi mã CANARY có trong context khi đã chạm các file `touched`. */
export const canariesFor = (repo: string, touched: string[]): string[] =>
  [...new Set(loadedFor(repo, touched).flatMap((l) => l.canaries))].sort();

/** Ước lượng token thô: ~4 ký tự / token (tiếng Việt có dấu thường tốn hơn; chỉ dùng để so tương đối). */
export const tokens = (chars: number) => Math.round(chars / 4);

export function ruleTable(repo: string): { file: string; rules: string[] }[] {
  return listFiles(repo).map((f) => ({
    file: f,
    rules: loadRules(repo)
      .filter((r) => r.fm.paths !== null && r.fm.paths.some((p) => matchGlob(f, p)))
      .map((r) => r.file.replace(".claude/rules/", "")),
  }));
}

export const SAMPLE_FILES = [
  { kind: "test", file: "src/auth/auth.test.ts" },
  { kind: "api", file: "src/api/customers.ts" },
  { kind: "terraform", file: "terraform/main.tf" },
  { kind: "utils", file: "src/utils/format.ts" },
];

export function tokenTable(repo: string, variantRoot: string) {
  return SAMPLE_FILES.map(({ kind, file }) => {
    const rules = loadedFor(repo, [file]).reduce((s, l) => s + l.chars, 0);
    const root = loadedFor(variantRoot, [file]).reduce((s, l) => s + l.chars, 0);
    return { kind, file, rulesTokens: tokens(rules), rootTokens: tokens(root), saved: 1 - rules / root };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const here = new URL(".", import.meta.url).pathname;
  const repo = process.argv[2] ?? join(here, "demo-repo");
  const variant = process.argv[3] ?? join(here, "variant-root");
  console.log("Rule trong .claude/rules/:");
  for (const r of loadRules(repo))
    console.log(`  ${r.file.padEnd(34)} paths=${r.fm.paths ? JSON.stringify(r.fm.paths) : "(không có → luôn nạp)"}`);
  console.log("\nFile → rule được nạp khi Claude đọc/sửa file đó:");
  for (const row of ruleTable(repo)) console.log(`  ${row.file.padEnd(36)} ${row.rules.join(", ") || "—"}`);
  console.log("\nToken quy ước trong context (ước lượng ký tự/4), khi sửa một file:");
  console.log(`  ${"loại".padEnd(10)} ${"file".padEnd(26)} ${"rules theo path".padStart(16)} ${"gom vào root".padStart(13)} ${"tiết kiệm".padStart(10)}`);
  for (const t of tokenTable(repo, variant))
    console.log(
      `  ${t.kind.padEnd(10)} ${t.file.padEnd(26)} ${String(t.rulesTokens).padStart(16)} ${String(t.rootTokens).padStart(13)} ${(t.saved * 100).toFixed(0).padStart(9)}%`,
    );
}
