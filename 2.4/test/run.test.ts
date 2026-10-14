// Bài 2.4 – kiểm thử. Phần server, check_config, secret_guard, setup_user_scope (dry-run) chạy THẬT, không cần model.
// Phần run_cli.sh dùng claude GIẢ (test/bin/claude) và thư mục kết quả tạm.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpClient } from "../../lib/mcp_client.ts";
import { check, section, summary } from "../../lib/check.ts";
import { checkConfig, expand } from "../check_config.ts";

const ROOT = join(import.meta.dirname, "..");
const SERVER = join(ROOT, "crm_db_server.ts");
const FAKE = join(ROOT, "test", "bin", "claude");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), `cca24-${p}-`));
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean).length;
const run = (cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) =>
  spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, env: { ...process.env, ...opts.env }, encoding: "utf8" });

section("Server crm-db: resource");
{
  const c = McpClient.forTsServer(SERVER, { CRM_DB_URL: "sqlite://./crm.db" });
  const init = await c.initialize();
  check("initialize khai báo capabilities.resources", init.result?.capabilities?.resources !== undefined);
  check("initialize vẫn khai báo capabilities.tools", init.result?.capabilities?.tools !== undefined);
  const list = (await c.request("resources/list")).result?.resources ?? [];
  const r0 = list[0] ?? {};
  check("resources/list có đúng 1 resource db://schema/main", list.length === 1 && r0.uri === "db://schema/main");
  check("resource có name, description, mimeType application/json", !!r0.name && !!r0.description && r0.mimeType === "application/json");
  const read = await c.request("resources/read", { uri: "db://schema/main" });
  const content = read.result?.contents?.[0];
  const schema = JSON.parse(content?.text ?? "{}");
  check("resources/read trả contents[0] cùng uri + mimeType", content?.uri === "db://schema/main" && content?.mimeType === "application/json");
  const tables = (schema.tables ?? []).map((t: any) => t.name);
  check("schema có 4 bảng users, matching_projects, favorites, applications", tables.join() === "users,matching_projects,favorites,applications");
  const fav = (schema.tables ?? []).find((t: any) => t.name === "favorites");
  check("favorites có cột kèm kiểu + khoá ngoại tới users/matching_projects",
    fav?.columns?.every((col: any) => col.type) && fav.columns.some((col: any) => col.references === "matching_projects.id"));
  check("schema ghi quan hệ giữa các bảng", (schema.relationships ?? []).length >= 3);
  check("schema nhận CRM_DB_URL từ env (minh hoạ ${VAR:-default})", schema.source === "sqlite://./crm.db");
  const bad = await c.request("resources/read", { uri: "db://schema/khong-co" });
  check("URI lạ → lỗi JSON-RPC -32002", bad.error?.code === -32002 && !bad.result);
  c.close();
}

section("Server crm-db: mô tả tool clear vs sparse");
{
  const clear = McpClient.forTsServer(SERVER);
  await clear.initialize();
  const tc = (await clear.request("tools/list")).result.tools as any[];
  check("2 tool query_matching_projects, find_user", tc.map((t) => t.name).join() === "query_matching_projects,find_user");
  check("mô tả clear 3–5 câu mỗi tool", tc.every((t) => sentences(t.description) >= 3 && sentences(t.description) <= 5),
    tc.map((t) => sentences(t.description)).join("/"));
  check("mô tả clear nói khi nào dùng thay Grep (so với built-in)", tc.every((t) => /Grep/.test(t.description)));
  check("mô tả query nhắc đọc resource db://schema/main", /db:\/\/schema\/main/.test(tc[0].description));
  const q = await clear.callTool("query_matching_projects", { trade: "điện", status: "open", min_budget_jpy: 1_000_000 });
  const qr = JSON.parse(q.result.content[0].text);
  check("query: dự án điện đang mở ≥ 1 triệu yên = #101, đã join owner_company",
    qr.resultCount === 1 && qr.results[0].id === 101 && qr.results[0].owner_company === "Tanaka Kensetsu");
  const none = JSON.parse((await clear.callTool("find_user", { email: "khong-co@example.com" })).result.content[0].text);
  check("find_user không thấy → resultCount 0, không phải isError", none.resultCount === 0);
  clear.close();

  const sparse = McpClient.forTsServer(SERVER, { DESC: "sparse" });
  await sparse.initialize();
  const ts = (await sparse.request("tools/list")).result.tools as any[];
  check("DESC=sparse: mô tả 1 câu ngắn", ts.every((t) => sentences(t.description) === 1 && t.description.length < 40));
  check("DESC=sparse: schema input giữ nguyên (chỉ đổi mô tả)",
    JSON.stringify(ts.map((t) => t.inputSchema)) === JSON.stringify(tc.map((t) => t.inputSchema)));
  sparse.close();
}

section("lib/mcp_server.ts: tương thích ngược khi KHÔNG có resources");
{
  const c = McpClient.forTsServer(join(ROOT, "..", "2.1", "shop_mcp_server.ts"));
  const init = await c.initialize();
  check("server không resources: capabilities chỉ có tools", JSON.stringify(init.result?.capabilities) === '{"tools":{}}');
  const r = await c.request("resources/list");
  check("server không resources: resources/list → -32601", r.error?.code === -32601);
  c.close();
}

section("check_config.ts");
{
  const good = JSON.parse(readFileSync(join(ROOT, "demo-project", ".mcp.json"), "utf8"));
  const unset = checkConfig(good, {});
  const errs = (f: ReturnType<typeof checkConfig>) => f.findings.filter((x) => x.level === "error");
  const warns = (f: ReturnType<typeof checkConfig>) => f.findings.filter((x) => x.level === "warn");
  check(".mcp.json mẫu: 0 lỗi", errs(unset).length === 0, JSON.stringify(errs(unset)));
  check("GITHUB_TOKEN chưa đặt → CẢNH BÁO (không phải lỗi)", warns(unset).some((w) => /GITHUB_TOKEN/.test(w.message)));
  check("biến có default (CRM_DB_URL, CRM_DESC, CLAUDE_CERT_DIR) không bị cảnh báo",
    !warns(unset).some((w) => /CRM_DB_URL|CRM_DESC|CLAUDE_CERT_DIR/.test(w.message)));
  check("liệt kê đủ 4 biến", unset.vars.map((v) => v.name).sort().join() === "CLAUDE_CERT_DIR,CRM_DB_URL,CRM_DESC,GITHUB_TOKEN");
  const set = checkConfig(good, { GITHUB_TOKEN: "x" });
  check("GITHUB_TOKEN đã đặt → hết cảnh báo", warns(set).length === 0);

  const bad = checkConfig(JSON.parse(readFileSync(join(ROOT, "demo-project", "bad.mcp.json"), "utf8")), {});
  const msgs = errs(bad).map((e) => `${e.where} ${e.message}`).join("\n");
  check("bad: url thiếu type bị bắt", /mcpServers\.github Có url nhưng thiếu type/.test(msgs));
  check("bad: token ghp_ viết cứng bị bắt", /ghp_/.test(msgs));
  check("bad: sk-… trong env bị bắt", /CRM_DB_PASSWORD.*sk-/.test(msgs));
  check("bad: server local thiếu command bị bắt", /mcpServers\.crm-db Local \(stdio\) server thiếu command/.test(msgs));
  check("type: ws được chấp nhận cho remote", errs(checkConfig({ mcpServers: { x: { type: "ws", url: "wss://a" } } }, {})).length === 0);
  check("thiếu mcpServers → lỗi", errs(checkConfig({}, {})).length === 1);

  check("expand: ${VAR:-d} chưa đặt → default", expand("${A:-sqlite://./crm.db}", {}) === "sqlite://./crm.db");
  check("expand: ${VAR:-d} đã đặt → giá trị env", expand("${A:-d}", { A: "pg://x" }) === "pg://x");
  check("expand: ${VAR} thiếu, không default → giữ nguyên chuỗi", expand("Bearer ${T}", {}) === "Bearer ${T}");

  const cli = run(process.execPath, ["--experimental-strip-types", "--no-warnings", "check_config.ts", "demo-project/bad.mcp.json"]);
  check("CLI: bad.mcp.json → exit 1", cli.status === 1 && /5 lỗi/.test(cli.stdout), cli.stdout.slice(-80));
}

section("secret_guard.sh (git repo tạm)");
{
  const repo = tmp("git");
  run("git", ["init", "-q"], { cwd: repo });
  copyFileSync(join(ROOT, "demo-project", ".mcp.json"), join(repo, ".mcp.json"));
  run("git", ["add", ".mcp.json"], { cwd: repo });
  const ok = run(join(ROOT, "secret_guard.sh"), [], { cwd: repo });
  check("staged .mcp.json dùng ${GITHUB_TOKEN} → exit 0", ok.status === 0, ok.stdout);
  copyFileSync(join(ROOT, "demo-project", "bad.mcp.json"), join(repo, ".mcp.json"));
  run("git", ["add", ".mcp.json"], { cwd: repo });
  const bad = run(join(ROOT, "secret_guard.sh"), [], { cwd: repo });
  check("staged token cứng → exit 1, báo đúng file:dòng", bad.status === 1 && /\.mcp\.json:6:.*ghp_/.test(bad.stdout), bad.stdout);
  const files = run(join(ROOT, "secret_guard.sh"), [join(ROOT, "demo-project", ".env.example")]);
  check("chế độ quét file: .env.example (để trống) → exit 0", files.status === 0);
}

section("setup_user_scope.sh (claude GIẢ, không đụng ~/.claude.json)");
{
  const log = join(tmp("argv"), "argv.log");
  const env = { CLAUDE_BIN: FAKE, FAKE_ARGV_LOG: log };
  const dry = run(join(ROOT, "setup_user_scope.sh"), [], { env });
  check("dry-run: in lệnh add --scope user, exit 0", dry.status === 0 && /mcp\s+add\s+--scope\s+user\s+crm-db-experimental/.test(dry.stdout));
  check("dry-run: KHÔNG gọi claude", !existsSync(log));
  const apply = run(join(ROOT, "setup_user_scope.sh"), ["--apply"], { env });
  const argv = existsSync(log) ? (JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0]!) as string[]) : [];
  check("--apply: gọi claude mcp add --scope user <tên> -e … -- node …",
    apply.status === 0 && argv.slice(0, 5).join(" ") === "mcp add --scope user crm-db-experimental" &&
      argv.includes("-e") && argv.includes("--") && argv.at(-1)!.endsWith("crm_db_server.ts"), argv.join(" "));
  const rm = run(join(ROOT, "setup_user_scope.sh"), ["--remove", "--apply"], { env });
  const last = JSON.parse(readFileSync(log, "utf8").trim().split("\n").at(-1)!) as string[];
  check("--remove --apply: claude mcp remove --scope user <tên>", rm.status === 0 && last.join(" ") === "mcp remove --scope user crm-db-experimental");
}

section("run_cli.sh + report_cli.ts (claude GIẢ)");
{
  const results = tmp("cli");
  const r = run(join(ROOT, "run_cli.sh"), ["all"], { env: { CLAUDE_BIN: FAKE, RESULTS_DIR: results } });
  check("run_cli.sh all chạy xong (exit 0)", r.status === 0, r.stderr.slice(-200));
  check("tạo 2 câu × 2 kiểu = 4 file stream-json",
    ["sparse", "clear"].every((s) => existsSync(join(results, s, "q0.jsonl")) && existsSync(join(results, s, "q1.jsonl"))));
  const cfg = JSON.parse(readFileSync(join(results, "sparse", "mcp.json"), "utf8"));
  check("config sinh ra là stdio crm-db với DESC=sparse", cfg.mcpServers["crm-db"].type === "stdio" && cfg.mcpServers["crm-db"].env.DESC === "sparse");
  check("report: sparse có gọi built-in, clear thì không", /DESC=sparse[\s\S]*built-in 4[\s\S]*DESC=clear[\s\S]*built-in 0/.test(r.stdout), r.stdout);
  check("report: câu hỏi schema đi qua ReadMcpResourceTool", /q1: 1 lần gọi · ReadMcpResourceTool/.test(r.stdout));
  const calls = readFileSync(join(results, "clear", "calls.log"), "utf8");
  check("server thật ghi log lần gọi tool (CRM_LOG)", /query_matching_projects/.test(calls));
}

summary();
