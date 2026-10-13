#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Bài 2.2 – Vòng hồi phục đọc metadata lỗi và rẽ nhánh.
//
// Đây là logic TẤT ĐỊNH bằng code: không gọi model, nên chạy thật được ngay. Nó đóng vai phần
// "agent" quyết định sau mỗi tool result. (Phần để LLM tự quyết dựa vào cùng metadata: xem run_llm.sh.)
//
//   isRetryable = true  (transient)  → gọi lại nguyên văn, tối đa 3 lần, backoff 0.2s → 0.4s → 0.8s
//   validation                       → sửa input (chuẩn hoá mã khách) rồi gọi lại 1 lần; không sửa được → hỏi lại khách
//   business                         → KHÔNG gọi lại, escalate kèm handoff (mã khách, số tiền, lý do)
//   permission                       → KHÔNG gọi lại, xin quyền cao hơn / chuyển nhân viên có quyền
//   isError=false, resultCount=0     → kết quả rỗng hợp lệ: trả lời "không tìm thấy", KHÔNG gọi lại
//   JSON-RPC error (lớp giao thức)    → tool không chạy: lỗi ở schema/client, báo dev, không vòng hồi phục
//
// Quy ước đếm: 1 lần gọi đầu + tối đa 3 lần retry = tối đa 4 lần gọi cho lỗi transient.
//
// Chạy:  node --experimental-strip-types recovery_agent.ts                    # structured rồi bad, in bảng so sánh
//        node --experimental-strip-types recovery_agent.ts structured|bad     # chỉ một bản
//        BACKOFF_SCALE=0.01 node --experimental-strip-types recovery_agent.ts # chạy nhanh (delay ×0.01)
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { McpClient, type RpcResponse } from "../lib/mcp_client.ts";

export const SERVER = join(import.meta.dirname, "support_mcp_server.ts");
export const MAX_RETRIES = 3;
const BASE_DELAY = 0.2;
const backoffScale = () => Number(process.env.BACKOFF_SCALE ?? "1");

type Style = "structured" | "bad";
type Args = Record<string, unknown>;
export type Outcome = "success" | "not_found" | "gave_up" | "ask_user" | "escalated" | "need_credentials" | "protocol_error";

export interface Handoff { customer_id: unknown; amount_usd: unknown; reason: string; recommended_action: string }
export interface RunResult {
  outcome: Outcome;
  delays: number[];
  data?: Record<string, unknown>;
  attempted?: number;
  handoff?: Handoff;
}

/** Client MCP có đếm số lần tools/call. Mỗi kịch bản một server mới để bộ đếm flaky tách bạch. */
class CountingClient {
  calls = 0;
  private client: McpClient;

  constructor(style: Style) {
    const env: Record<string, string> = { ERROR_STYLE: style };
    if (process.env.SUPPORT_LOG) env.SUPPORT_LOG = process.env.SUPPORT_LOG;
    this.client = McpClient.forTsServer(SERVER, env);
  }

  init() { return this.client.initialize(); }

  callTool(name: string, args: Args): Promise<RpcResponse> {
    this.calls++;
    return this.client.callTool(name, args);
  }

  close() { this.client.close(); }
}

/** Thử sửa mã khách sai định dạng: "cus 12", "cus-0012", "CUS12" → "CUS-0012". Không đoán được thì null. */
export function fixCustomerId(raw: unknown): string | null {
  const m = /^cus[\s\-_]*(\d{1,4})$/i.exec(String(raw ?? "").trim());
  return m ? `CUS-${String(Number(m[1])).padStart(4, "0")}` : null;
}

function metadataOf(result: any): any {
  if (result.structuredContent) return result.structuredContent;
  try {
    return JSON.parse(String(result.content?.[0]?.text ?? ""));
  } catch {
    return null;
  }
}

// ---- Agent đọc metadata -----------------------------------------------------------------------

async function handleStructured(client: CountingClient, tool: string, args: Args, log: string[]): Promise<RunResult> {
  let retries = 0;
  let fixed = false;
  const delays: number[] = [];
  const scale = backoffScale();
  for (;;) {
    const resp = await client.callTool(tool, args);
    if (resp.error) {
      log.push(`  ✗ lớp giao thức ${resp.error.code}: ${resp.error.message} → tool không chạy, báo dev sửa schema/client`);
      return { outcome: "protocol_error", delays };
    }

    const result = resp.result;
    const meta = metadataOf(result);
    if (!result.isError) {
      if (meta.resultCount === 0) {
        log.push("  ○ rỗng hợp lệ (isError=false, resultCount=0) → trả lời khách: không tìm thấy, KHÔNG gọi lại");
        return { outcome: "not_found", delays };
      }
      log.push(`  ✓ thành công: ${JSON.stringify(meta).slice(0, 110)}`);
      return { outcome: "success", data: meta, delays };
    }

    const category = meta.errorCategory;
    log.push(`  ! ${category} (isRetryable=${meta.isRetryable}): ${String(meta.description).slice(0, 90)}…`);
    if (meta.isRetryable) {
      if (retries >= MAX_RETRIES) {
        log.push(`  ✗ hết ${MAX_RETRIES} lần retry → báo lên: đã thử ${client.calls} lần, lỗi transient, chưa có dữ liệu`);
        return { outcome: "gave_up", attempted: retries + 1, delays };
      }
      const delay = BASE_DELAY * 2 ** retries * scale;
      retries++;
      delays.push(delay);
      log.push(`    ↻ retry ${retries}/${MAX_RETRIES} sau ${(delay / scale).toFixed(2)}s`);
      await sleep(delay * 1000);
      continue;
    }

    switch (category) {
      case "validation": {
        const candidate = fixCustomerId(args.customer_id);
        if (!fixed && candidate && candidate !== args.customer_id) {
          log.push(`    ✎ sửa input customer_id '${args.customer_id}' → '${candidate}' rồi gọi lại (lần gọi mới, không phải retry)`);
          args = { ...args, customer_id: candidate };
          fixed = true;
          continue;
        }
        log.push("  ? không tự sửa được → hỏi lại khách mã đúng (dạng CUS-NNNN)");
        return { outcome: "ask_user", delays };
      }
      case "business": {
        const handoff: Handoff = { customer_id: args.customer_id, amount_usd: args.amount, reason: meta.description,
                                   recommended_action: "Quản lý duyệt hoàn tiền vượt hạn mức" };
        log.push(`  ⇧ escalate cho quản lý, KHÔNG retry. Handoff: ${JSON.stringify(handoff).slice(0, 120)}…`);
        return { outcome: "escalated", handoff, delays };
      }
      case "permission":
        log.push("  🔑 xin quyền finance-read / chuyển nhân viên cấp cao, KHÔNG retry với cùng tài khoản");
        return { outcome: "need_credentials", delays };
      default:
        log.push(`  ✗ errorCategory lạ '${category}' → escalate`);
        return { outcome: "escalated", delays };
    }
  }
}

// ---- Agent "ngây thơ" với lỗi kiểu cũ: chỉ biết isError + chữ "Error" ---------------------------
// Không có category hay isRetryable, cách duy nhất là đoán: thử lại 3 lần rồi chuyển người.

async function handleNaive(client: CountingClient, tool: string, args: Args, log: string[]): Promise<RunResult> {
  let retries = 0;
  const delays: number[] = [];
  const scale = backoffScale();
  for (;;) {
    const resp = await client.callTool(tool, args);
    if (resp.error) {
      log.push(`  ✗ lớp giao thức: ${resp.error.message}`);
      return { outcome: "protocol_error", delays };
    }
    const result = resp.result;
    if (!result.isError) {
      log.push("  ✓ thành công");
      return { outcome: "success", delays };
    }
    log.push(`  ! "${result.content?.[0]?.text}" (không biết loại lỗi, không biết có nên thử lại)`);
    if (retries >= MAX_RETRIES) {
      log.push(`  ⇧ thử ${client.calls} lần vẫn lỗi → chuyển người xử lý`);
      return { outcome: "escalated", delays };
    }
    const delay = BASE_DELAY * 2 ** retries * scale;
    retries++;
    delays.push(delay);
    log.push(`    ↻ đoán là lỗi tạm thời, thử lại ${retries}/${MAX_RETRIES}`);
    await sleep(delay * 1000);
  }
}

const handle = (style: Style) => (style === "bad" ? handleNaive : handleStructured);

// ---- Kịch bản ---------------------------------------------------------------------------------

export interface Scenario { id: number; name: string; tool: string; args: Args; expect: Outcome; expectCalls: number }

export const SCENARIOS: Scenario[] = [
  { id: 1, name: "Tra khách bình thường", tool: "get_customer", args: { customer_id: "CUS-0012" },
    expect: "success", expectCalls: 1 },
  { id: 2, name: "Khách không tồn tại (rỗng hợp lệ)", tool: "get_customer", args: { customer_id: "CUS-9999" },
    expect: "not_found", expectCalls: 1 },
  { id: 3, name: "DB chập chờn: timeout 2 lần rồi được", tool: "get_customer",
    args: { customer_id: "CUS-0042", simulate: "flaky:2" }, expect: "success", expectCalls: 3 },
  { id: 4, name: "DB sập: timeout mãi", tool: "get_customer",
    args: { customer_id: "CUS-0012", simulate: "timeout" }, expect: "gave_up", expectCalls: 4 },
  { id: 5, name: "Mã khách gõ sai nhưng sửa được", tool: "get_customer", args: { customer_id: "cus 12" },
    expect: "success", expectCalls: 2 },
  { id: 6, name: "Mã khách sai không đoán được", tool: "get_customer", args: { customer_id: "order-abc" },
    expect: "ask_user", expectCalls: 1 },
  { id: 7, name: "Hoàn 750 USD (vượt hạn mức 500)", tool: "process_refund",
    args: { customer_id: "CUS-0012", amount: 750 }, expect: "escalated", expectCalls: 1 },
  { id: 8, name: "Hồ sơ tài chính bị hạn chế", tool: "get_customer", args: { customer_id: "CUS-0777" },
    expect: "need_credentials", expectCalls: 1 },
  { id: 9, name: "Hoàn 49.5 USD (trong hạn mức)", tool: "process_refund",
    args: { customer_id: "CUS-0012", amount: 49.5 }, expect: "success", expectCalls: 1 },
  { id: 10, name: "Gọi tool không tồn tại (lớp giao thức)", tool: "get_custmer",
    args: { customer_id: "CUS-0012" }, expect: "protocol_error", expectCalls: 1 },
];

export async function runScenario(style: Style, sc: Scenario): Promise<RunResult & { calls: number; log: string[] }> {
  const client = new CountingClient(style);
  try {
    await client.init();
    const log: string[] = [];
    const r = await handle(style)(client, sc.tool, { ...sc.args }, log);
    return { ...r, calls: client.calls, log };
  } finally {
    client.close();
  }
}

// Lan truyền lỗi có chọn lọc: tra nhiều khách, khách nào lỗi hết retry thì báo lên kèm kết quả phần còn lại.
export async function runBatch(style: Style) {
  const ids: [string, string | null][] = [["CUS-0012", null], ["CUS-0042", "timeout"], ["CUS-9999", null]];
  const client = new CountingClient(style);
  try {
    await client.init();
    const found: string[] = [];
    const empty: string[] = [];
    const failed: { customer_id: string; outcome: Outcome }[] = [];
    const log: string[] = [];
    for (const [id, sim] of ids) {
      const args: Args = { customer_id: id };
      if (sim) args.simulate = sim;
      const r = await handle(style)(client, "get_customer", args, log);
      if (r.outcome === "success") found.push(id);
      else if (r.outcome === "not_found") empty.push(id);
      else failed.push({ customer_id: id, outcome: r.outcome });
    }
    const report = { searched: ids.length, found, not_found: empty, failed, total_calls: client.calls };
    return { report, log };
  } finally {
    client.close();
  }
}

async function runStyle(style: Style) {
  console.log(`\n================ ERROR_STYLE=${style} ================`);
  const out = new Map<number, Awaited<ReturnType<typeof runScenario>>>();
  for (const sc of SCENARIOS) {
    const r = await runScenario(style, sc);
    console.log(`\n[${sc.id}] ${sc.name}  (${sc.tool} ${JSON.stringify(sc.args)})`);
    for (const l of r.log) console.log(l);
    console.log(`  → kết cục: ${r.outcome} sau ${r.calls} lần gọi`);
    out.set(sc.id, r);
  }
  return out;
}

// Chạy trực tiếp (không phải bị import từ test). import.meta.main chỉ có từ Node 24.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2) as Style[];
  const styles: Style[] = argv.length ? argv : ["structured", "bad"];
  const results = new Map<Style, Awaited<ReturnType<typeof runStyle>>>();
  for (const s of styles) results.set(s, await runStyle(s));

  for (const s of styles) {
    const b = await runBatch(s);
    console.log(`\n[Lan truyền lỗi, ${s}] tra 3 khách, CUS-0042 bị timeout mãi:`);
    console.log(`  Báo cáo gửi coordinator: ${JSON.stringify(b.report)}`);
  }

  if (styles.length === 2) {
    console.log("\n================ SO SÁNH ================");
    const row = (a: string, b: string, c: string, d: string) =>
      console.log(`${a.padEnd(4)} ${b.padEnd(40)} ${c.padEnd(26)} ${d.padEnd(26)}`);
    row("#", "Kịch bản", "structured", "bad");
    for (const sc of SCENARIOS) {
      const a = results.get("structured")!.get(sc.id)!;
      const b = results.get("bad")!.get(sc.id)!;
      row(String(sc.id), sc.name.slice(0, 40), `${a.outcome} (${a.calls} lần)`, `${b.outcome} (${b.calls} lần)`);
    }
    const total = (s: Style) => [...results.get(s)!.values()].reduce((n, r) => n + r.calls, 0);
    console.log(`Tổng số lần gọi tool: structured ${total("structured")}, bad ${total("bad")}`);
  }
}
