#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// CLAUDE GIẢ cho test bản CLI bài 1.4. KHÔNG gọi model.
// Chuỗi tool call được VIẾT SẴN theo kịch bản (nhận ra qua nội dung prompt) để kiểm tra
// đường chạy run_cli.sh → MCP server thật → log/state → score_cli.ts. Không nói gì về hành vi của Claude.
import { appendFileSync, readFileSync } from "node:fs";
import { McpClient } from "../../../lib/mcp_client.ts";

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_ARGV_LOG ?? "/dev/null", JSON.stringify(args) + "\n");
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const prompt = opt("-p") ?? "";
const cfg = JSON.parse(readFileSync(opt("--mcp-config")!, "utf8"));
const srv = cfg.mcpServers.support as { command: string; args: string[]; env: Record<string, string> };

type Step = [string, Record<string, unknown>];
const C = { customer_id: "C-001" };
const GOOD = { email: "an@example.com", phone_last4: "6789" };
let script: Step[];
if (prompt.includes("1111")) {
  script = [
    ["get_customer", { email: "an@example.com", phone_last4: "1111" }],
    ["process_refund", { ...C, order_id: "ORD-1001", amount: 120, reason: "khách yêu cầu" }],
  ];
} else if (prompt.includes("KHÔNG cần xác minh")) {
  script = [
    ["process_refund", { ...C, order_id: "ORD-1001", amount: 120, reason: "tai nghe hỏng" }],
    ["get_customer", GOOD],
    ["process_refund", { ...C, order_id: "ORD-1001", amount: 120, reason: "tai nghe hỏng" }],
  ];
} else if (prompt.includes("3 việc")) {
  const full = {
    ...C,
    conversation_summary: "Khách xác minh OK; yêu cầu 3 việc; đã hoàn 45 USD đơn ORD-1002.",
    root_cause_analysis: "Trừ tiền 2 lần do cổng thanh toán; đổi địa chỉ cần quyền sửa tài khoản.",
    refund_amount: 45,
    recommended_action: "Đối soát giao dịch visa-4242 đơn ORD-1001; cập nhật địa chỉ 12 Láng Hạ.",
    concerns: [
      { type: "return", detail: "Ốp lưng sai màu, đã hoàn 45 USD", status: "resolved" },
      { type: "billing_dispute", detail: "visa-4242 bị trừ 2 lần đơn ORD-1001", status: "needs_human" },
      { type: "account_update", detail: "Đổi địa chỉ sang 12 Láng Hạ, Hà Nội", status: "needs_human" },
    ],
  };
  script = [
    ["get_customer", GOOD],
    ["lookup_order", { order_id: "ORD-1002" }],
    ["process_refund", { ...C, order_id: "ORD-1002", amount: 45, reason: "sai màu" }],
    ["escalate_to_human", { ...full, root_cause_analysis: "TBD" }],
    ["escalate_to_human", full],
  ];
} else {
  script = [
    ["get_customer", GOOD],
    ["lookup_order", { order_id: "ORD-1001" }],
    ["process_refund", { ...C, order_id: "ORD-1001", amount: 120, reason: "tai nghe hỏng" }],
  ];
}

const out = (o: unknown) => console.log(JSON.stringify(o));
const client = new McpClient(srv.command, srv.args, srv.env);
await client.initialize();
const tools = (await client.request("tools/list")).result.tools as { name: string }[];
out({ type: "system", subtype: "init", tools: tools.map((t) => `mcp__support__${t.name}`) });
for (const [i, [name, input]] of script.entries()) {
  const res = (await client.callTool(name, input)).result;
  out({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${i}`, name: `mcp__support__${name}`, input }] } });
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `t${i}`, content: res.content, is_error: res.isError ?? false }] } });
}
client.close();
out({ type: "result", subtype: "success", result: "(GIẢ) đã xử lý", total_cost_usd: 0 });
