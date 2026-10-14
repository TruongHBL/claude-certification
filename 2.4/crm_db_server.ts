// Bài 2.4 – MCP server "crm-db" (stdio) cho module CRM matching.
//
//   - Resource db://schema/main: catalogue schema (bảng, cột, kiểu, quan hệ). Agent đọc một lần là biết
//     DB có gì, không phải gọi list_tables rồi describe_table cho từng bảng.
//   - Tool query_matching_projects, find_user: thao tác trên dữ liệu (dữ liệu giả lập trong bộ nhớ).
//   - DESC=sparse → mô tả 1 câu (dễ thua Grep/Bash có mô tả dài); mặc định DESC=clear → 3–5 câu.
//   - CRM_DB_URL chỉ để minh hoạ ${VAR:-default} trong .mcp.json: server in ra nguồn dữ liệu, không kết nối thật.
//
// Chạy:  node --experimental-strip-types --no-warnings crm_db_server.ts
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runServer, textResult, type ToolDef, type ResourceDef } from "../lib/mcp_server.ts";

const DB_URL = process.env.CRM_DB_URL ?? "(chưa đặt)";
const STYLE = process.env.DESC === "sparse" ? "sparse" : "clear";

export const SCHEMA = {
  database: "crm_matching",
  source: DB_URL,
  tables: [
    {
      name: "users",
      description: "Người dùng CRM: công ty đăng dự án hoặc nhà thầu nhận dự án",
      columns: [
        { name: "id", type: "integer", primaryKey: true },
        { name: "email", type: "varchar(255)", unique: true },
        { name: "company_name", type: "varchar(255)" },
        { name: "role", type: "enum('owner','contractor','admin')" },
        { name: "prefecture", type: "varchar(32)" },
        { name: "created_at", type: "datetime" },
      ],
    },
    {
      name: "matching_projects",
      description: "Dự án đăng lên để tìm nhà thầu",
      columns: [
        { name: "id", type: "integer", primaryKey: true },
        { name: "owner_id", type: "integer", references: "users.id" },
        { name: "title", type: "varchar(255)" },
        { name: "trade", type: "varchar(64)", note: "ngành nghề, vd 'điện', 'nội thất'" },
        { name: "budget_jpy", type: "integer" },
        { name: "status", type: "enum('open','matched','closed')" },
        { name: "published_at", type: "datetime" },
      ],
    },
    {
      name: "favorites",
      description: "Nhà thầu đánh dấu ♡ một dự án",
      columns: [
        { name: "user_id", type: "integer", references: "users.id" },
        { name: "project_id", type: "integer", references: "matching_projects.id" },
        { name: "created_at", type: "datetime" },
      ],
      unique: [["user_id", "project_id"]],
    },
    {
      name: "applications",
      description: "Nhà thầu ứng tuyển vào dự án",
      columns: [
        { name: "id", type: "integer", primaryKey: true },
        { name: "project_id", type: "integer", references: "matching_projects.id" },
        { name: "contractor_id", type: "integer", references: "users.id" },
        { name: "status", type: "enum('pending','accepted','rejected')" },
      ],
    },
  ],
  relationships: [
    "users 1—n matching_projects (owner_id)",
    "users n—n matching_projects qua favorites",
    "users 1—n applications (contractor_id); matching_projects 1—n applications",
  ],
};

const USERS = [
  { id: 1, email: "owner@tanaka-kensetsu.example", company_name: "Tanaka Kensetsu", role: "owner", prefecture: "Tokyo" },
  { id: 2, email: "info@sato-denki.example", company_name: "Sato Denki", role: "contractor", prefecture: "Kanagawa" },
  { id: 3, email: "hello@yamada-interior.example", company_name: "Yamada Interior", role: "contractor", prefecture: "Tokyo" },
];

const PROJECTS = [
  { id: 101, owner_id: 1, title: "Thi công điện văn phòng 3F", trade: "điện", budget_jpy: 1_200_000, status: "open" },
  { id: 102, owner_id: 1, title: "Nội thất cửa hàng Shibuya", trade: "nội thất", budget_jpy: 3_500_000, status: "open" },
  { id: 103, owner_id: 1, title: "Sửa hệ thống chiếu sáng kho", trade: "điện", budget_jpy: 600_000, status: "matched" },
];

const DESCRIPTIONS = {
  sparse: {
    query_matching_projects: "Searches data.",
    find_user: "Gets a user.",
  },
  clear: {
    query_matching_projects:
      "Truy vấn bảng matching_projects của DB CRM theo ngành nghề (trade), trạng thái (status) và ngân sách tối thiểu. " +
      "Trả về JSON gồm id, title, trade, budget_jpy, status và owner_company đã join sẵn từ users. " +
      "Dùng khi câu hỏi về DỮ LIỆU dự án đang có trong hệ thống (vd 'dự án điện nào đang mở trên 1 triệu yên'). " +
      "Nên dùng tool này thay cho Grep/Read: dữ liệu nằm trong DB chứ không nằm trong file mã nguồn, và thay cho " +
      "Bash + sqlite vì tool đã chặn câu lệnh ghi và tự join bảng. Muốn biết DB có bảng/cột gì thì đọc resource db://schema/main trước.",
    find_user:
      "Tìm MỘT người dùng CRM theo email hoặc id, trả về id, email, company_name, role, prefecture. " +
      "Dùng khi cần biết ai sở hữu dự án hoặc thông tin một nhà thầu. " +
      "Không tìm được thì trả resultCount 0 (không phải lỗi, không cần gọi lại). " +
      "Không dùng Grep để tìm người dùng: email thật nằm trong DB, không có trong repo.",
  },
} as const;

export function toolDefs(style: "sparse" | "clear"): ToolDef[] {
  const d = DESCRIPTIONS[style];
  return [
    {
      name: "query_matching_projects",
      description: d.query_matching_projects,
      inputSchema: {
        type: "object",
        properties: {
          trade: { type: "string", description: "Ngành nghề, vd 'điện'" },
          status: { type: "string", enum: ["open", "matched", "closed"] },
          min_budget_jpy: { type: "integer", minimum: 0 },
        },
      },
    },
    {
      name: "find_user",
      description: d.find_user,
      inputSchema: {
        type: "object",
        properties: { email: { type: "string" }, id: { type: "integer" } },
      },
    },
  ];
}

export const RESOURCES: ResourceDef[] = [
  {
    uri: "db://schema/main",
    name: "CRM matching – schema",
    description: "Danh sách bảng, cột, kiểu dữ liệu và quan hệ của DB CRM matching. Đọc trước khi truy vấn.",
    mimeType: "application/json",
    read: () => JSON.stringify(SCHEMA, null, 2),
  },
];

function logCall(name: string, args: Record<string, unknown>): void {
  const log = process.env.CRM_LOG;
  if (log) appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), style: STYLE, tool: name, args }) + "\n");
}

const companyOf = (id: number) => USERS.find((u) => u.id === id)?.company_name ?? null;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runServer({
    name: "crm-db",
    tools: toolDefs(STYLE),
    resources: RESOURCES,
    onCall: logCall,
    handlers: {
      query_matching_projects: (a) => {
        const rows = PROJECTS.filter(
          (p) =>
            (a.trade === undefined || p.trade === a.trade) &&
            (a.status === undefined || p.status === a.status) &&
            (a.min_budget_jpy === undefined || p.budget_jpy >= Number(a.min_budget_jpy)),
        ).map((p) => ({ ...p, owner_company: companyOf(p.owner_id) }));
        return textResult({ results: rows, resultCount: rows.length, source: DB_URL });
      },
      find_user: (a) => {
        const u = USERS.find((x) => (a.email !== undefined && x.email === a.email) || (a.id !== undefined && x.id === Number(a.id)));
        return textResult({ results: u ? [u] : [], resultCount: u ? 1 : 0 });
      },
    },
  });
}
