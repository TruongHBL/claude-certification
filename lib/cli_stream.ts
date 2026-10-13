// Đọc output `claude -p --output-format stream-json --verbose` (mỗi dòng một event JSON).
import { readFileSync, existsSync } from "node:fs";

export interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  message?: { id?: string; role?: string; content?: any; stop_reason?: string | null };
  [k: string]: any;
}

export function readStream(path: string): StreamEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as StreamEvent];
      } catch {
        return [];
      }
    });
}

/** Mọi block tool_use của assistant, theo thứ tự xuất hiện. */
export function toolUses(events: StreamEvent[]): { id: string; name: string; input: any; parent: string | null }[] {
  return events.flatMap((e) =>
    e.type === "assistant" && Array.isArray(e.message?.content)
      ? e.message!.content
          .filter((b: any) => b.type === "tool_use")
          .map((b: any) => ({ id: b.id, name: b.name, input: b.input, parent: e.parent_tool_use_id ?? null }))
      : [],
  );
}

export function resultEvent(events: StreamEvent[]): StreamEvent | undefined {
  return events.findLast((e) => e.type === "result");
}
