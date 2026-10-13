// Kiểm tra tĩnh cấu hình phân bổ tool (chạy thật, tất định, không gọi model).
// Chạy: node --experimental-strip-types config_check.ts
import { pathToFileURL } from "node:url";
import { AGENTS, SCOPED_CROSS_ROLE, SUBAGENTS, type AgentConfig, type Role } from "./tool_config.ts";

const GENERIC_NAMES = ["fetch_url", "analyze", "analyze_document", "analyze_content", "process", "run", "do_task",
  "execute", "get_data", "handle", "helper", "tool", "search"];

export interface CheckRow {
  name: string;
  ok: boolean;
  detail: string;
}

export function checks(
  agents: Record<Role, AgentConfig> = AGENTS,
  scoped: Record<string, { owner: Role }> = SCOPED_CROSS_ROLE,
): CheckRow[] {
  const out: CheckRow[] = [];
  const add = (name: string, ok: boolean, detail: string) => out.push({ name, ok, detail });

  for (const a of SUBAGENTS) {
    const n = agents[a].tools.length;
    add(`${a}: 4–5 tool`, n >= 4 && n <= 5, `${n} tool`);
  }

  const owners = new Map<string, Role[]>();
  for (const [a, cfg] of Object.entries(agents) as [Role, AgentConfig][]) {
    for (const t of cfg.tools) owners.set(t.name, [...(owners.get(t.name) ?? []), a]);
  }
  const dup = [...owners].filter(([name, list]) => list.length > 1 && !Object.hasOwn(scoped, name));
  add("không tool nào trùng giữa các role (trừ scoped)", dup.length === 0, dup.length === 0 ? "OK" : JSON.stringify(dup));

  for (const [name, meta] of Object.entries(scoped)) {
    const list = owners.get(name) ?? [];
    const ownerOk = list.length === 1 && list[0] === meta.owner;
    const desc = agents[meta.owner].tools.find((t) => t.name === name)?.description ?? "";
    add(`scoped ${name} chỉ ở ${meta.owner} và mô tả có giới hạn`,
      ownerOk && desc.includes("[SCOPED]") && desc.includes("coordinator"),
      `owner=${JSON.stringify(list)}`);
  }

  const allNames = [...owners.keys()];
  const generic = allNames.filter((n) => GENERIC_NAMES.includes(n));
  add("không có tên tool chung chung / fetch_url", generic.length === 0, generic.length === 0 ? "OK" : JSON.stringify(generic));

  const domain = SUBAGENTS.flatMap((a) => agents[a].tools.map((t) => t.name));
  const leaked = agents.coordinator.tools.map((t) => t.name).filter((n) => domain.includes(n));
  add("coordinator không giữ tool nghiệp vụ", leaked.length === 0, leaked.length === 0 ? "OK" : JSON.stringify(leaked));

  const allTools = Object.values(agents).flatMap((c) => c.tools);
  const shortDesc = allNames.filter((n) => (allTools.find((t) => t.name === n)?.description ?? "").length < 40);
  add("mọi tool có mô tả ≥ 40 ký tự", shortDesc.length === 0, shortDesc.length === 0 ? "OK" : JSON.stringify(shortDesc));

  const first = agents.doc_analysis.tool_choice(1);
  const second = agents.doc_analysis.tool_choice(2);
  add("doc_analysis: lượt 1 ép extract_metadata, lượt 2 auto",
    first.type === "tool" && first.name === "extract_metadata" && second.type === "auto",
    `${JSON.stringify(first)} → ${JSON.stringify(second)}`);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const rows = checks();
  console.log("== Bảng tool theo agent ==");
  for (const [a, cfg] of Object.entries(AGENTS)) {
    const names = cfg.tools.map((t) => (Object.hasOwn(SCOPED_CROSS_ROLE, t.name) ? `${t.name}*` : t.name));
    console.log(`  ${a.padEnd(13)} ${names.length} tool  ${names.join(", ")}`);
  }
  console.log("  (* = scoped cross-role)");
  console.log("\n== Kiểm tra ==");
  for (const r of rows) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}  [${r.detail}]`);
  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\n${rows.length - failed}/${rows.length} đạt`);
  process.exitCode = failed === 0 ? 0 : 1;
}
