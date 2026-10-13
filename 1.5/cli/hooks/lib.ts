// Tiện ích chung cho shell hook bài 1.5 (bản CLI).
// Mỗi hook là MỘT TIẾN TRÌNH RIÊNG do Claude Code chạy: input JSON qua stdin, output qua stdout + exit code.
// Vì vậy state (AML đã pass, hàng đợi escalation) phải nằm trên đĩa, không giữ trong bộ nhớ như bản SDK.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const REFUND_LIMIT_USD = 500;
export const STATE_DIR = process.env.HOOK_STATE_DIR ?? join(import.meta.dirname, "..", "state");
mkdirSync(STATE_DIR, { recursive: true });

export interface HookInput {
  session_id: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, any>;
  tool_response?: unknown;
  tool_use_id: string;
}

export const hookInput = (): HookInput => JSON.parse(readFileSync(0, "utf8")) as HookInput;
export const shortName = (full: string | undefined): string => String(full ?? "").replace(/^mcp__ops__/, "");

// exit 0 + JSON permissionDecision "deny": tool không chạy, lý do được đưa cho Claude.
// (Cách khác: in lý do ra stderr rồi exit 2. Exit 1 KHÔNG chặn.)
export function deny(reason: string): never {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }) + "\n",
  );
  process.exit(0);
}

export const appendJsonl = (file: string, obj: unknown): void =>
  appendFileSync(join(STATE_DIR, file), JSON.stringify(obj) + "\n");

type Block = { type?: string; text?: string };

// tool_response của MCP tool có thể là chuỗi, mảng content block, hoặc { content: [...] } → đọc cả 3
export function readPayload(resp: unknown): Record<string, any> | null {
  const blocks = Array.isArray(resp) ? resp : resp && typeof resp === "object" ? (resp as { content?: unknown }).content : null;
  const t =
    typeof resp === "string"
      ? resp
      : (Array.isArray(blocks) ? (blocks as Block[]) : []).find((b) => b && typeof b === "object" && b.type === "text")?.text;
  if (t == null) return null;
  try {
    return JSON.parse(t) as Record<string, any>;
  } catch {
    return null;
  }
}

// Trả lại đúng "hình dạng" đã nhận, chỉ thay nội dung
export function writePayload(resp: unknown, data: unknown): unknown {
  const t = JSON.stringify(data);
  if (typeof resp === "string") return t;
  if (Array.isArray(resp)) return [{ type: "text", text: t }];
  return { ...(resp as Record<string, unknown>), content: [{ type: "text", text: t }] };
}
