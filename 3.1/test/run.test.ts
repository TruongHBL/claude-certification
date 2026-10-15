// Bài 3.1 – kiểm thử. expected_loading, lint_config, user_level_demo.sh chạy THẬT (không cần model, không đụng
// ~/.claude thật: mọi file user-level là file tạm). run_cli.sh chạy với claude GIẢ (test/bin/claude).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, section, summary } from "../../lib/check.ts";
import { expectedLoading, importsOf, USER_CANARY } from "../expected_loading.ts";
import { lintRepo } from "../lint_config.ts";
import { compare } from "../report_cli.ts";

const ROOT = join(import.meta.dirname, "..");
const DEMO = join(ROOT, "demo-repo");
const BAD = join(ROOT, "test", "fixtures", "bad-repo");
const USER_FIXTURE = join(ROOT, "test", "fixtures", "user_claude.md");
const FAKE = join(ROOT, "test", "bin", "claude");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), `cca31-${p}-`));
const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });
const canaries = (cwd: string, o: { user?: boolean; reads?: string[]; repo?: string } = {}) =>
  expectedLoading({
    repoRoot: o.repo ?? DEMO,
    cwd: join(o.repo ?? DEMO, cwd),
    userLevel: !!o.user,
    userClaudeMd: USER_FIXTURE,
    readFiles: (o.reads ?? []).map((r) => join(o.repo ?? DEMO, r)),
  });

section("expected_loading: mô hình nạp file");
{
  const root = canaries(".");
  check("cwd=gốc, người mới: project → import → rule, đúng thứ tự", root.map((l) => l.canary).join(",") === "CANARY-PROJECT-7Q,CANARY-IMPORT-NAMING-2M,CANARY-RULES-TESTING-4K", root.map((l) => l.label).join(","));
  check("import nằm NGAY sau file chứa nó (nạp eager, inline)", root[1].kind === "import" && root[1].label === "standards/naming.md");
  check("@../standards/naming.md tính từ .claude/ (file chứa import), không phải cwd", importsOf(join(DEMO, ".claude", "CLAUDE.md"))[0]?.raw === "../standards/naming.md" && root[1].canary === "CANARY-IMPORT-NAMING-2M");
  check("cwd=gốc: packages/api/CLAUDE.md CHƯA nạp lúc khởi động", !root.some((l) => l.canary === "CANARY-DIR-API-9X"));
  const api = canaries("packages/api");
  check("cwd=packages/api: thêm CLAUDE.md của thư mục, đứng CUỐI", api.at(-1)?.canary === "CANARY-DIR-API-9X" && api.at(-1)?.when === "launch");
  check("cwd=packages/web: không có CLAUDE.md riêng, chỉ cấp project", canaries("packages/web").length === 3);
  const od = canaries(".", { reads: ["packages/api/src/routes.ts"] });
  check("cwd=gốc + Claude đọc file trong packages/api → CLAUDE.md thư mục nạp on-demand", od.at(-1)?.canary === "CANARY-DIR-API-9X" && od.at(-1)?.when === "on-demand");
  const me = canaries(".", { user: true });
  check("có user-level: user nạp ĐẦU TIÊN (rộng nhất trước)", me[0]?.kind === "user" && me[0]?.canary === USER_CANARY);

  const repo = tmp("local");
  cpSync(DEMO, repo, { recursive: true });
  cpSync(join(repo, "CLAUDE.local.md.example"), join(repo, "CLAUDE.local.md"));
  writeFileSync(join(repo, ".claude", "rules", "api-only.md"), "---\npaths:\n  - \"packages/api/**\"\n---\nCANARY-RULE-SCOPED-1Z\n");
  const withLocal = canaries(".", { repo });
  check("CLAUDE.local.md nạp SAU CLAUDE.md cùng cấp", withLocal.at(-1)?.kind === "local" && withLocal.findIndex((l) => l.kind === "local") > withLocal.findIndex((l) => l.kind === "project"));
  check("rule có frontmatter paths KHÔNG nạp lúc khởi động (bài 3.3)", !withLocal.some((l) => l.canary === "CANARY-RULE-SCOPED-1Z"));

  const deep = tmp("depth");
  mkdirSync(join(deep, ".git"));
  writeFileSync(join(deep, "CLAUDE.md"), "@a1.md\n");
  for (let i = 1; i <= 6; i++) writeFileSync(join(deep, `a${i}.md`), `CANARY-HOP-${i}\n${i < 6 ? `@a${i + 1}.md` : ""}\n`);
  const hops = expectedLoading({ repoRoot: deep, cwd: deep, userLevel: false }).filter((l) => l.kind === "import").length;
  check("import lồng tối đa 4 bước", hops === 4, `nạp ${hops}`);
  writeFileSync(join(deep, "b.md"), "Viết `@a1.md` trong code span thì KHÔNG import\n```\n@a2.md\n```\nemail lan@example.vn cũng không\n");
  check("@ trong code span, code block, email: không phải import", importsOf(join(deep, "b.md")).length === 0);
}

section("lint_config: repo tốt / repo lỗi");
{
  check("demo-repo: 0 lỗi, 0 cảnh báo", lintRepo(DEMO).length === 0, JSON.stringify(lintRepo(DEMO)));
  const bad = lintRepo(BAD);
  const has = (lv: string, re: RegExp) => bad.some((f) => f.level === lv && re.test(f.msg + f.file));
  check('bắt từ khoá "@import" (ERROR)', has("ERROR", /@import/));
  check("bắt import không tồn tại, chỉ rõ tính từ .claude/ (ERROR)", has("ERROR", /\.claude\/standards\/naming\.md/));
  check("import đúng (@../docs/review.md) không bị báo", !bad.some((f) => /review\.md/.test(f.msg)));
  check("CLAUDE.md > 200 dòng (WARN)", has("WARN", /232 dòng/));
  check("quy tắc cứng NEVER / tuyệt đối không → gợi ý settings.json/hook (WARN ×2)", bad.filter((f) => /settings\.json/.test(f.msg)).length === 2);
  check("CLAUDE.local.md không bị gitignore (ERROR)", has("ERROR", /gitignore/));
  const r = run(process.execPath, ["--experimental-strip-types", "--no-warnings", "lint_config.ts", BAD]);
  check("CLI: repo lỗi → exit code 1", r.status === 1 && /3 lỗi, 3 cảnh báo/.test(r.stdout), r.stdout);
  const noIgnore = tmp("gi");
  cpSync(DEMO, noIgnore, { recursive: true });
  writeFileSync(join(noIgnore, ".gitignore"), "node_modules/\n");
  check("có .example mà .gitignore thiếu CLAUDE.local.md (WARN)", lintRepo(noIgnore).some((f) => f.level === "WARN" && f.file === ".gitignore"));
}

section("user_level_demo.sh trên file TẠM (không đụng ~/.claude thật)");
{
  const home = tmp("home");
  const target = join(home, ".claude", "CLAUDE.md");
  mkdirSync(join(home, ".claude"));
  const original = "# Sở thích cá nhân\n- Trả lời ngắn gọn.\n";
  writeFileSync(target, original);
  const sh = (arg?: string) => run("bash", ["user_level_demo.sh", ...(arg ? [arg] : [])], { HOME: home });
  const dry = sh();
  check("mặc định là dry-run: in khối, KHÔNG sửa file", /dry-run/.test(dry.stdout) && readFileSync(target, "utf8") === original);
  check("đích mặc định là $HOME/.claude/CLAUDE.md", dry.stdout.includes(target));
  sh("--apply");
  sh("--apply");
  const applied = readFileSync(target, "utf8");
  check("--apply thêm khối có BEGIN/END + CANARY-USER-3H, chạy 2 lần không trùng", applied.split("BEGIN cca-3.1-demo").length === 2 && applied.includes(USER_CANARY) && applied.startsWith(original));
  check("--status báo CÓ", /CÓ khối/.test(sh("--status").stdout));
  sh("--revert");
  check("--revert trả file về y nguyên ban đầu", readFileSync(target, "utf8") === original);
  check("có file backup trước khi sửa", readdirSync(join(home, ".claude")).some((f) => f.startsWith("CLAUDE.md.bak-")));
}

section("run_cli.sh với claude GIẢ");
{
  const t = tmp("cli");
  const argv = join(t, "argv.log");
  const env = { CLAUDE_BIN: FAKE, TMP_DIR: join(t, "tmp"), RESULTS_DIR: join(t, "res"), FAKE_USER_CLAUDE_MD: USER_FIXTURE, USER_CLAUDE_MD: USER_FIXTURE, FAKE_ARGV_LOG: argv };
  const r = run("bash", ["run_cli.sh", "all"], env);
  check("run_cli.sh all chạy xong", r.status === 0, r.stderr);
  check("report: 7/7 khớp mô hình", /7\/7 khớp/.test(r.stdout), r.stdout.slice(-300));
  check("bản clone 'me' có CLAUDE.local.md, 'newcomer' không có (bị gitignore)", existsSync(join(t, "tmp", "me", "CLAUDE.local.md")) && !existsSync(join(t, "tmp", "newcomer", "CLAUDE.local.md")));
  const calls = readFileSync(argv, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { cwd: string; args: string[] });
  check("đúng 7 lệnh claude -p", calls.length === 7);
  check("không lệnh nào dùng --safe-mode (cờ đó tắt CLAUDE.md)", calls.every((c) => !c.args.includes("--safe-mode")));
  check("mọi lệnh: --model haiku, có --max-budget-usd, stream-json", calls.every((c) => c.args.includes("haiku") && c.args.includes("--max-budget-usd") && c.args.includes("stream-json")));
  check("phiên newcomer có --setting-sources project,local; phiên me không có", calls.every((c) => c.cwd.includes("/newcomer") === c.args.includes("--setting-sources")));
  check("lần on-demand bật Read, các lần khác --tools rỗng", calls.filter((c) => c.args.includes("Read")).length === 1);
  const rows = compare(join(t, "res"), join(t, "tmp"), USER_FIXTURE);
  const row = (who: string, name: string) => rows.find((x) => x.who === who && x.name === name)!;
  check("me thấy CANARY-USER-3H và CANARY-LOCAL-5T; newcomer không thấy", row("me", "root").seen.includes(USER_CANARY) && row("me", "root").seen.includes("CANARY-LOCAL-5T") && !row("newcomer", "root").seen.includes(USER_CANARY) && !row("newcomer", "root").seen.includes("CANARY-LOCAL-5T"));
  check("on-demand: có Read packages/api/src/routes.ts và thấy CANARY-DIR-API-9X", row("newcomer", "root-ondemand").reads.some((p) => p.endsWith("packages/api/src/routes.ts")) && row("newcomer", "root-ondemand").seen.includes("CANARY-DIR-API-9X"));

  // Report phải bắt được sai lệch: sửa kết quả 1 lệnh cho thiếu một canary và dư một canary.
  const f = join(t, "res", "newcomer", "web.jsonl");
  const lines = readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const res = lines.find((e) => e.type === "result");
  res.result = "CANARY-PROJECT-7Q\nCANARY-RULES-TESTING-4K\nCANARY-USER-3H";
  writeFileSync(f, lines.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const web = compare(join(t, "res"), join(t, "tmp"), USER_FIXTURE).find((x) => x.who === "newcomer" && x.name === "web")!;
  check("report bắt THIẾU (import) và DƯ (user-level ở người mới)", !web.ok && web.missing.includes("CANARY-IMPORT-NAMING-2M") && web.extra.includes(USER_CANARY));
}

summary();
