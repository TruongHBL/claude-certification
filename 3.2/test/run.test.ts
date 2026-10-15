// Bài 3.2 – kiểm thử. skill_files, lint_skills, expected_commands, user_skill_demo.sh chạy THẬT (không cần model;
// HOME giả trong thư mục tạm, không đụng ~/.claude thật). run_cli.sh chạy với claude GIẢ (test/bin/claude).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, section, summary } from "../../lib/check.ts";
import { readStream } from "../../lib/cli_stream.ts";
import { fakeUserConfig, table, visibleCommands } from "../expected_commands.ts";
import { lintRepo } from "../lint_skills.ts";
import { isolation, listedNames, report } from "../report_cli.ts";
import { effectiveCommands, parseFrontmatter, scanConfigDir, toolList } from "../skill_files.ts";

const ROOT = join(import.meta.dirname, "..");
const DEMO = join(ROOT, "demo-repo");
const FAKE = join(ROOT, "test", "bin", "claude");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), `cca32-${p}-`));
const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });

section("skill_files: đọc skill và command");
{
  const { entries, flatInSkills } = scanConfigDir(join(DEMO, ".claude"));
  const names = entries.map((e) => `${e.kind}:${e.name}`).sort();
  check("demo-repo tạo đúng 2 lệnh: command /review + skill /analyse-feature", names.join(",") === "command:review,skill:analyse-feature", names.join(","));
  check("file phẳng .claude/skills/lint.md KHÔNG thành lệnh, bị ghi nhận là bẫy", flatInSkills.length === 1 && flatInSkills[0].endsWith("lint.md"));
  const af = entries.find((e) => e.name === "analyse-feature")!;
  check("analyse-feature có context: fork, allowed-tools Read Grep Glob, argument-hint, description", af.frontmatter.context === "fork" && toolList(af.frontmatter["allowed-tools"]).join(",") === "Read,Grep,Glob" && !!af.frontmatter["argument-hint"] && !!af.frontmatter.description);
  check("command /review dùng $ARGUMENTS", entries.find((e) => e.name === "review")!.body.includes("$ARGUMENTS"));
  const fm = parseFrontmatter("---\nname: my-cmd\nallowed-tools: [Read, Grep]\n---\nbody");
  check("frontmatter: field name đổi tên lệnh; allowed-tools dạng [a, b]", fm.frontmatter.name === "my-cmd" && toolList(fm.frontmatter["allowed-tools"]).join(",") === "Read,Grep" && fm.body === "body");
  const dup = effectiveCommands([
    { name: "deploy", kind: "command", file: "c", frontmatter: {}, body: "" },
    { name: "deploy", kind: "skill", file: "s", frontmatter: {}, body: "" },
  ]);
  check("skill và command trùng tên: skill thắng", dup.get("deploy")?.kind === "skill");
  const p = scanConfigDir(join(ROOT, "personal-as-config-dir-does-not-exist"));
  check("thư mục không tồn tại: không lỗi, 0 lệnh", p.entries.length === 0);
}

section("lint_skills: repo mẫu và repo xấu");
{
  const demo = lintRepo(DEMO);
  check("demo-repo: đúng 1 lỗi (file phẳng lint.md)", demo.filter((f) => f.level === "lỗi").length === 1 && demo.some((f) => f.file.endsWith("lint.md")));
  check("demo-repo: có ghi chú allowed-tools chỉ pre-approve, không giới hạn", demo.some((f) => f.level === "ghi chú" && /pre-approve/.test(f.message)));
  check("demo-repo: không cảnh báo thiếu context: fork (analyse-feature đã có)", !demo.some((f) => /context: fork/.test(f.message)));

  const bad = tmp("bad");
  mkdirSync(join(bad, ".claude", "skills", "explore"), { recursive: true });
  mkdirSync(join(bad, ".claude", "skills", "deploy"), { recursive: true });
  mkdirSync(join(bad, ".claude", "commands"), { recursive: true });
  writeFileSync(join(bad, ".claude", "skills", "explore", "SKILL.md"), "---\nallowed-tools: Read Grep Glob Write Bash\n---\nKhám phá toàn bộ codebase: Grep rồi Read mọi file.\n");
  writeFileSync(join(bad, ".claude", "skills", "deploy", "SKILL.md"), "---\ndescription: Deploy checklist\n---\nChạy checklist.\n");
  writeFileSync(join(bad, ".claude", "commands", "deploy.md"), "Bản cũ của deploy.\n");
  writeFileSync(join(bad, ".claude", "skills", "notes.md"), "phẳng\n");
  writeFileSync(join(bad, "CLAUDE.md"), "# Quy trình review\n1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n");
  const f = lintRepo(bad);
  const has = (re: RegExp) => f.some((x) => re.test(x.message));
  check("bắt file .md phẳng trong skills/", has(/phẳng/));
  check("bắt SKILL.md thiếu description", has(/Thiếu description/));
  check("bắt skill khám phá thiếu context: fork", has(/thiếu `context: fork`/));
  check("bắt skill khám phá có Write/Bash trong allowed-tools", has(/Write, Bash/));
  check("bắt skill và command trùng tên", has(/trùng tên/));
  check("bắt quy trình nhiều bước trong CLAUDE.md", has(/quy trình 6 bước/));
  const cli = run(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "lint_skills.ts"), bad]);
  check("lint_skills.ts trả mã lỗi ≠ 0 khi có lỗi", cli.status === 1 && /Lệnh tạo ra/.test(cli.stdout));
}

section("expected_commands: phiên nào thấy lệnh nào (bước 5)");
{
  const home = fakeUserConfig(join(ROOT, "personal"));
  const t = Object.fromEntries(table(DEMO, home).map((r) => [r.name, r]));
  check("/review và /analyse-feature: người mới clone CÓ (đi theo git)", t.review.newcomer && t["analyse-feature"].newcomer);
  check("/brainstorm: chỉ máy mình có, người mới KHÔNG", t.brainstorm.me && !t.brainstorm.newcomer);
  check("/lint: không ai có (file phẳng)", !t.lint.me && !t.lint.newcomer);
  check("skill cá nhân có context: fork, nguồn user", visibleCommands(DEMO, home).find((v) => v.name === "brainstorm")?.source === "user" && visibleCommands(DEMO, home).find((v) => v.name === "brainstorm")?.fork === true);
  // personal thắng project khi trùng tên
  const clash = tmp("clash");
  cpSync(join(home, "skills"), join(clash, "skills"), { recursive: true });
  mkdirSync(join(clash, "skills", "review"), { recursive: true });
  writeFileSync(join(clash, "skills", "review", "SKILL.md"), "---\ndescription: review cá nhân\n---\nx\n");
  check("trùng tên giữa user và project: personal thắng", visibleCommands(DEMO, clash).find((v) => v.name === "review")?.source === "user");
}

section("user_skill_demo.sh: HOME giả, không đụng ~/.claude thật");
{
  const h = tmp("home");
  const env = { USER_SKILLS_DIR: join(h, ".claude", "skills") };
  const dest = join(h, ".claude", "skills", "brainstorm");
  const dry = run(join(ROOT, "user_skill_demo.sh"), [], env);
  check("mặc định dry-run: in kế hoạch, không tạo thư mục", dry.status === 0 && /dry-run/.test(dry.stdout) && !existsSync(dest));
  check("--status trước khi cài: CHƯA CÀI", /CHƯA CÀI/.test(run(join(ROOT, "user_skill_demo.sh"), ["--status"], env).stdout));
  const ap = run(join(ROOT, "user_skill_demo.sh"), ["--apply"], env);
  check("--apply: copy SKILL.md + file đánh dấu", ap.status === 0 && existsSync(join(dest, "SKILL.md")) && existsSync(join(dest, ".cca-3.2-demo")));
  check("--apply lần 2: không lỗi, không làm gì thêm", run(join(ROOT, "user_skill_demo.sh"), ["--apply"], env).status === 0);
  check("--revert: gỡ đúng thư mục demo", run(join(ROOT, "user_skill_demo.sh"), ["--revert"], env).status === 0 && !existsSync(dest));
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "SKILL.md"), "skill thật của user\n");
  const refuse = run(join(ROOT, "user_skill_demo.sh"), ["--apply"], env);
  check("đã có brainstorm thật: --apply TỪ CHỐI, không ghi đè", refuse.status === 1 && readFileSync(join(dest, "SKILL.md"), "utf8") === "skill thật của user\n");
  const rv = run(join(ROOT, "user_skill_demo.sh"), ["--revert"], env);
  check("brainstorm không có file đánh dấu: --revert TỪ CHỐI, không xoá", rv.status === 1 && existsSync(join(dest, "SKILL.md")));
}

section("run_cli.sh với claude GIẢ (đường ống, không phải hành vi thật)");
{
  const h = tmp("e2e");
  const env = {
    CLAUDE_BIN: FAKE,
    TMP_DIR: join(h, "tmp"),
    RESULTS_DIR: join(h, "res"),
    USER_SKILLS_DIR: join(h, ".claude", "skills"),
    FAKE_USER_CLAUDE_DIR: join(h, ".claude"),
    FAKE_ARGV_LOG: join(h, "argv.jsonl"),
  };
  const r = run(join(ROOT, "run_cli.sh"), ["all"], env);
  check("run_cli.sh all chạy xong", r.status === 0, r.stderr);
  const nofork = readFileSync(join(h, "tmp", "clone-nofork", ".claude", "skills", "analyse-feature", "SKILL.md"), "utf8");
  check("clone-nofork chỉ khác ở dòng context: fork", !/context: fork/.test(nofork) && /allowed-tools/.test(nofork));
  const argv = readFileSync(join(h, "argv.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  check("4 lệnh claude -p", argv.length === 4);
  check("lệnh list dùng --tools \"\" (không tool)", argv[0].args.includes("--tools") && argv[0].args[argv[0].args.indexOf("--tools") + 1] === "");
  check("fork/nofork gửi đúng prompt /analyse-feature favorites", argv[1].args.includes("/analyse-feature favorites") && argv[2].args.includes("/analyse-feature favorites"));
  check("mọi lệnh có --max-budget-usd, stream-json, không --safe-mode", argv.every((a: any) => a.args.includes("--max-budget-usd") && a.args.includes("stream-json") && !a.args.includes("--safe-mode")));
  const l = listedNames(readStream(join(h, "res", "list.jsonl")));
  check("init: bỏ tên plugin, chỉ giữ 4 tên của bài", ![...l.skills, ...l.slash].some((n) => n.includes(":")) && l.slash.includes("review"));
  const f = isolation(readStream(join(h, "res", "fork.jsonl")));
  const nf = isolation(readStream(join(h, "res", "nofork.jsonl")));
  const au = isolation(readStream(join(h, "res", "auto.jsonl")));
  check("fork: 0 ký tự tool trong hội thoại chính, có forked-command", f.mainToolChars === 0 && f.forkToolChars > 0 && f.forkedCommand);
  check("nofork: nội dung file đổ vào hội thoại chính", nf.mainToolChars > 1000 && nf.forkToolCalls === 0);
  check("auto: Claude gọi tool Skill nhờ description", au.skillToolCalled);
  const rep = report(join(h, "res")).join("\n");
  check("report: 4 dòng OK ở bảng lệnh, kết luận fork giữ output ngoài", (rep.match(/OK {2}/g) ?? []).length === 4 && /giữ output khám phá ngoài/.test(rep));
  check("không tạo gì trong ~/.claude/skills giả khi chưa --apply", !existsSync(join(h, ".claude", "skills", "brainstorm")));
}

summary();
