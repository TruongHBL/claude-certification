// Bài 2.4 – kiểm tĩnh một file .mcp.json trước khi commit.
//
//   LỖI (exit 1):   thiếu mcpServers · entry có url mà thiếu type http/sse · entry local thiếu command/args
//                   · giá trị trông như secret thật (ghp_, github_pat_, sk-, xoxb-, AKIA…, "Bearer <chuỗi dài>")
//   CẢNH BÁO:       biến ${VAR} không có default và chưa đặt trong env hiện tại. Giống Claude Code: chỉ cảnh báo,
//                   không dừng nạp config → token thiếu sẽ không "kêu" lỗi, phải tự kiểm.
//
// Chạy:  node --experimental-strip-types --no-warnings check_config.ts demo-project/.mcp.json
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface Finding {
  level: "error" | "warn" | "info";
  where: string;
  message: string;
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bghp_[A-Za-z0-9_]{16,}/, "GitHub personal access token (ghp_…)"],
  [/\bgithub_pat_[A-Za-z0-9_]{16,}/, "GitHub fine-grained token (github_pat_…)"],
  [/\bsk-[A-Za-z0-9_-]{16,}/, "API key dạng sk-…"],
  [/\bxox[abp]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/Bearer\s+(?!\$\{)[A-Za-z0-9._~+\/-]{20,}/, "Bearer token viết cứng"],
];

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(:-([^}]*))?\}/g;

export interface VarRef {
  name: string;
  default?: string;
  where: string;
}

/** Duyệt mọi chuỗi trong object, gọi fn(chuỗi, đường dẫn). */
function walkStrings(v: unknown, path: string, fn: (s: string, path: string) => void): void {
  if (typeof v === "string") fn(v, path);
  else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${path}[${i}]`, fn));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walkStrings(x, `${path}.${k}`, fn);
}

/** Mở rộng ${VAR} và ${VAR:-default} giống Claude Code (biến thiếu, không default → giữ nguyên chuỗi). */
export function expand(s: string, env: Record<string, string | undefined>): string {
  return s.replace(VAR_RE, (whole, name: string, _d, def: string | undefined) =>
    env[name] !== undefined && env[name] !== "" ? env[name]! : def !== undefined ? def : whole,
  );
}

export function checkConfig(config: unknown, env: Record<string, string | undefined> = process.env): {
  findings: Finding[];
  vars: VarRef[];
} {
  const findings: Finding[] = [];
  const vars: VarRef[] = [];
  const servers = (config as { mcpServers?: Record<string, Record<string, unknown>> } | null)?.mcpServers;
  if (!servers || typeof servers !== "object") {
    findings.push({ level: "error", where: "(root)", message: "Thiếu object mcpServers" });
    return { findings, vars };
  }
  if (Object.keys(servers).length === 0) findings.push({ level: "error", where: "mcpServers", message: "Không có server nào" });

  for (const [name, entry] of Object.entries(servers)) {
    const where = `mcpServers.${name}`;
    const type = entry.type as string | undefined;
    if (entry.url !== undefined) {
      if (type !== "http" && type !== "sse" && type !== "ws")
        findings.push({
          level: "error",
          where,
          message: `Có url nhưng ${type === undefined ? "thiếu" : `type="${type}" sai,`} type: "http" (hoặc "sse"/"ws"). Claude Code sẽ coi là stdio và bỏ qua server này`,
        });
      else findings.push({ level: "info", where, message: `Remote server (${type}) → ${entry.url}` });
    } else {
      if (typeof entry.command !== "string" || !entry.command)
        findings.push({ level: "error", where, message: "Local (stdio) server thiếu command" });
      if (entry.args !== undefined && !Array.isArray(entry.args))
        findings.push({ level: "error", where, message: "args phải là mảng" });
      else if (entry.args === undefined)
        findings.push({ level: "warn", where, message: "Local server không có args (hợp lệ nếu command tự đủ)" });
      if (typeof entry.command === "string") findings.push({ level: "info", where, message: `Local server (stdio) → ${entry.command}` });
    }

    walkStrings(entry, where, (s, path) => {
      for (const [re, label] of SECRET_PATTERNS)
        if (re.test(s)) findings.push({ level: "error", where: path, message: `Có vẻ là secret viết cứng: ${label}. Dùng \${VAR} thay thế` });
      for (const m of s.matchAll(VAR_RE)) vars.push({ name: m[1]!, default: m[3], where: path });
    });
  }

  for (const v of vars) {
    const set = env[v.name] !== undefined && env[v.name] !== "";
    if (!set && v.default === undefined)
      findings.push({
        level: "warn",
        where: v.where,
        message: `\${${v.name}} chưa đặt và không có default → Claude Code chỉ cảnh báo, giá trị sẽ hỏng (vd header "Bearer \${${v.name}}")`,
      });
    else if (!set)
      findings.push({ level: "info", where: v.where, message: `\${${v.name}} chưa đặt → dùng default "${v.default}"` });
  }
  return { findings, vars };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2] ?? ".mcp.json";
  const { findings, vars } = checkConfig(JSON.parse(readFileSync(file, "utf8")));
  console.log(`Kiểm ${file}`);
  const icon = { error: "✗ LỖI     ", warn: "! CẢNH BÁO", info: "· info    " };
  for (const f of findings) console.log(`${icon[f.level]} ${f.where}: ${f.message}`);
  console.log(`Biến môi trường dùng: ${vars.map((v) => (v.default !== undefined ? `${v.name} (mặc định ${v.default})` : v.name)).join(", ") || "(không có)"}`);
  const errors = findings.filter((f) => f.level === "error").length;
  const warns = findings.filter((f) => f.level === "warn").length;
  console.log(`→ ${errors} lỗi, ${warns} cảnh báo`);
  process.exitCode = errors ? 1 : 0;
}
