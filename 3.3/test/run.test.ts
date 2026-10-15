// Test bài 3.3: matcher glob, frontmatter, bảng file → rule, token, biến thể root, lint, run_cli.sh với claude giả.
// Chạy: node --experimental-strip-types --no-warnings test/run.test.ts   (trong thư mục 3.3/)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob } from "node:path";
import { check, section, summary } from "../../lib/check.ts";
import { lint } from "../lint_rules.ts";
import { buildVariantClaudeMd } from "../make_variant.ts";
import { canariesFor, expandBraces, matchGlob, parseFrontmatter, ruleTable, tokenTable } from "../match_rules.ts";
import { compare } from "../report_cli.ts";

const HERE = join(import.meta.dirname, "..");
const REPO = join(HERE, "demo-repo");
const VARIANT = join(HERE, "variant-root");
const BAD = join(HERE, "test", "fixtures", "bad-repo");

section("Matcher glob (đối chiếu với path.matchesGlob của Node)");
const cases: [string, string, boolean][] = [
  ["src/auth/auth.test.ts", "**/*.test.ts", true],
  ["auth.test.ts", "**/*.test.ts", true], // `**/` = 0 thư mục
  ["src/components/Button.test.tsx", "**/*.test.{ts,tsx}", true],
  ["src/components/Button.tsx", "**/*.test.{ts,tsx}", false],
  ["src/api/customers.spec.ts", "**/*.spec.ts", true],
  ["src/api/customers.ts", "src/api/**/*.ts", true],
  ["src/api/v2/orders.ts", "src/api/**/*.ts", true],
  ["lib/api/customers.ts", "src/api/**/*.ts", false],
  ["routes/favorites.ts", "**/routes/**/*.ts", true],
  ["src/routes/admin/users.ts", "**/routes/**/*.ts", true],
  ["src/matching/matching.controller.ts", "**/*.controller.ts", true],
  ["terraform/main.tf", "terraform/**/*", true],
  ["infra/terraform/main.tf", "terraform/**/*", false], // glob tính từ gốc project
  ["infrastructure/network.tf", "**/*.tf", true],
  ["README.md", "*.md", true],
  ["docs/README.md", "*.md", false], // `*` không vượt qua `/`
  ["src/a.ts", "src/?.ts", true],
  ["src/ab.ts", "src/?.ts", false],
  ["src/b.ts", "src/[abc].ts", true],
];
for (const [f, p, want] of cases) {
  const mine = matchGlob(f, p);
  const node = matchesGlob(f, p);
  check(`${p}  ~  ${f} → ${want}`, mine === want && node === want, `mine=${mine} node=${node}`);
}
check("brace lồng nhau mở đúng", JSON.stringify(expandBraces("{a,b}/*.{ts,tsx}")) === JSON.stringify(["a/*.ts", "a/*.tsx", "b/*.ts", "b/*.tsx"]));
check("`[` không đóng → không khớp gì (như tài liệu)", matchGlob("photos [2024/x.png", "photos [2024/**") === false);

section("Frontmatter");
const list = parseFrontmatter('---\npaths:\n  - "src/**/*.ts"\n  - "lib/*.ts"\n---\n\n# R\n');
check("YAML list", JSON.stringify(list.paths) === '["src/**/*.ts","lib/*.ts"]' && list.body.trim() === "# R");
check("chuỗi phân tách dấu phẩy", JSON.stringify(parseFrontmatter('---\npaths: "a/*.ts, b/*.ts"\n---\nx').paths) === '["a/*.ts","b/*.ts"]');
check("mảng YAML dạng [ ]", JSON.stringify(parseFrontmatter('---\npaths: ["a/*.ts", "b/*.ts"]\n---\nx').paths) === '["a/*.ts","b/*.ts"]');
check("không có frontmatter → paths null (luôn nạp)", parseFrontmatter("# Rule\n- a\n").paths === null);
const broken = parseFrontmatter("---\npaths:\n  - a\n  hỏng\n---\nx");
check("frontmatter hỏng → error + paths null (nạp mọi phiên)", !!broken.error && broken.paths === null);
check("field khác paths bị ghi nhận là bỏ qua", parseFrontmatter("---\ndescription: x\npaths: a\n---\n").ignoredFields.includes("description"));

section("Bảng file → rule trên demo-repo");
const table = Object.fromEntries(ruleTable(REPO).map((r) => [r.file, r.rules.join(",")]));
const expectRules: Record<string, string> = {
  "src/auth/auth.test.ts": "testing.md",
  "src/components/Button.test.tsx": "testing.md",
  "src/dashboard/Dashboard.test.tsx": "testing.md",
  "src/favorites/favorites.test.ts": "testing.md",
  "src/matching/matching.test.ts": "testing.md",
  "src/utils/format.test.ts": "testing.md",
  "src/api/customers.spec.ts": "api-conventions.md,testing.md",
  "src/api/customers.ts": "api-conventions.md",
  "routes/favorites.ts": "api-conventions.md",
  "src/matching/matching.controller.ts": "api-conventions.md",
  "terraform/main.tf": "terraform.md",
  "terraform/variables.tf": "terraform.md",
  "infrastructure/network.tf": "terraform.md",
  "infrastructure/README.md": "terraform.md",
  "src/utils/format.ts": "",
  "src/auth/auth.ts": "",
  "src/components/Button.tsx": "",
};
for (const [f, want] of Object.entries(expectRules)) check(`${f} → ${want || "—"}`, table[f] === want, `nhận "${table[f]}"`);
const testDirs = new Set(Object.keys(table).filter((f) => table[f].includes("testing.md")).map((f) => f.split("/").slice(0, -1).join("/")));
check("rule testing phủ test co-located ở ≥ 6 thư mục bằng 1 file", testDirs.size >= 6, `${testDirs.size} thư mục`);

section("CANARY theo ca (mô hình)");
check("không chạm file nào → chỉ root", canariesFor(REPO, []).join() === "CANARY-ROOT-2K");
check("đọc file test → root + test", canariesFor(REPO, ["src/auth/auth.test.ts"]).join() === "CANARY-ROOT-2K,CANARY-RULE-TEST-5M");
check("đọc .spec.ts trong src/api → nạp cả API và test", canariesFor(REPO, ["src/api/customers.spec.ts"]).length === 3);
check("đọc file utils → không rule nào", canariesFor(REPO, ["src/utils/format.ts"]).join() === "CANARY-ROOT-2K");
check("biến thể root: mọi CANARY luôn có", canariesFor(VARIANT, []).length === 4);

section("Token (bước 6)");
const tok = tokenTable(REPO, VARIANT);
check("mọi ca: rules theo path ít token hơn gom vào root", tok.every((t) => t.rulesTokens < t.rootTokens));
check("file utils tiết kiệm nhiều nhất (không rule nào liên quan)", tok.find((t) => t.kind === "utils")!.saved === Math.max(...tok.map((t) => t.saved)));
check("variant-root/CLAUDE.md đúng bằng bản sinh từ demo-repo (không lệch tay)", readFileSync(join(VARIANT, "CLAUDE.md"), "utf8") === buildVariantClaudeMd(REPO));

section("Lint");
check("demo-repo: không cảnh báo", lint(REPO).length === 0);
const bad = lint(BAD);
const has = (re: RegExp, level = "WARN") => bad.some((f) => f.level === level && re.test(f.message));
check("bắt frontmatter hỏng", has(/frontmatter hỏng/));
check("bắt glob gõ sai không khớp file nào", has(/tset\.ts.*không khớp/));
check("bắt 3 CLAUDE.md thư mục giống nhau", has(/3 CLAUDE\.md thư mục/));
check("gợi ý chuyển quy ước theo loại file khỏi root", has(/quy ước theo loại file/, "INFO"));
check("gợi ý quy trình nhiều bước nên là skill", has(/nên là skill/, "INFO"));
check("ghi nhận field bị bỏ qua", has(/bị bỏ qua/, "INFO"));
check("variant-root: gợi ý tách quy ước khỏi root", lint(VARIANT).some((f) => /quy ước theo loại file/.test(f.message)));

section("run_cli.sh với claude GIẢ (không gọi model)");
const work = mkdtempSync(join(tmpdir(), "b33-"));
try {
  const env = {
    ...process.env,
    CLAUDE_BIN: join(HERE, "test", "bin", "claude"),
    TMP_DIR: join(work, "tmp"),
    RESULTS_DIR: join(work, "res"),
    FAKE_ARGV_LOG: join(work, "argv.log"),
  };
  execFileSync("bash", [join(HERE, "run_cli.sh"), "prepare"], { env });
  execFileSync("bash", [join(HERE, "run_cli.sh"), "run"], { env });
  const argv = readFileSync(join(work, "argv.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  check("10 lệnh claude (2 biến thể × 5 ca)", argv.length === 10, `${argv.length}`);
  check("mọi lệnh dùng haiku + stream-json + trần chi phí", argv.every((a) => a.args.includes("haiku") && a.args.includes("stream-json") && a.args.includes("--max-budget-usd")));
  check("không lệnh nào dùng --safe-mode (sẽ tắt rules)", argv.every((a) => !a.args.includes("--safe-mode")));
  check("ca none không cho tool; ca đọc file chỉ cho Read", argv.every((a) => (a.args[a.args.indexOf("--tools") + 1] === "" ) || a.args[a.args.indexOf("--tools") + 1] === "Read"));
  const rows = compare(join(work, "res"), join(work, "tmp"));
  check("report: 10/10 ca khớp mô hình", rows.length === 10 && rows.every((r) => r.ok));
  const tk = (v: string, k: string) => rows.find((r) => r.variant === v && r.kind === k)!.inputTokens!;
  check("report: biến thể root tốn nhiều input token hơn ở ca utils", tk("root", "utils") > tk("rules", "utils"));
  const out = execFileSync("bash", [join(HERE, "run_cli.sh"), "report"], { env, encoding: "utf8" });
  check("report in tổng kết", /10\/10 ca khớp mô hình/.test(out));
} finally {
  rmSync(work, { recursive: true, force: true });
}

summary();
