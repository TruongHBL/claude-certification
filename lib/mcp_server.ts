// MCP server tối giản qua stdio (JSON-RPC 2.0, mỗi message một dòng), không cần thư viện.
// Đủ cho initialize / notifications/* / ping / tools/list / tools/call.
//
// Lỗi giao thức (tool không tồn tại, method lạ, JSON hỏng) → JSON-RPC `error`.
// Lỗi khi chạy tool → `result` bình thường kèm isError: true (xem bài 2.2).
import { createInterface } from "node:readline";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;

export interface ServerOptions {
  name: string;
  version?: string;
  tools: ToolDef[];
  handlers: Record<string, ToolHandler>;
  /** Gọi trước mỗi tools/call (vd ghi log), kể cả khi tool không tồn tại. */
  onCall?: (name: string, args: Record<string, unknown>) => void;
}

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

/** Tiện ích: kết quả text từ một object (JSON). */
export function textResult(data: unknown, extra: Partial<ToolResult> = {}): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], ...extra };
}

export function runServer(opts: ServerOptions): void {
  const write = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
  const respond = (id: RpcMessage["id"], result: unknown) => write({ jsonrpc: "2.0", id, result });
  const respondError = (id: RpcMessage["id"], code: number, message: string) =>
    write({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  const rl = createInterface({ input: process.stdin });
  // Xử lý tuần tự theo thứ tự nhận để output giữ đúng thứ tự request.
  let queue: Promise<void> = Promise.resolve();
  rl.on("line", (line) => {
    queue = queue.then(() => handle(line));
  });

  async function handle(line: string): Promise<void> {
    if (!line.trim()) return;
    let msg: RpcMessage;
    try {
      msg = JSON.parse(line) as RpcMessage;
    } catch {
      respondError(null, -32700, "Parse error");
      return;
    }
    const { id, method, params = {} } = msg;
    switch (method) {
      case "initialize":
        respond(id, {
          protocolVersion: (params.protocolVersion as string | undefined) ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: opts.name, version: opts.version ?? "1.0.0" },
        });
        return;
      case "notifications/initialized":
      case "notifications/cancelled":
        return; // notification: không trả lời
      case "ping":
        respond(id, {});
        return;
      case "tools/list":
        respond(id, { tools: opts.tools });
        return;
      case "tools/call": {
        const name = String(params.name ?? "");
        const args = (params.arguments as Record<string, unknown> | undefined) ?? {};
        opts.onCall?.(name, args);
        const handler = opts.handlers[name];
        if (!handler) {
          respondError(id, -32602, `Unknown tool: ${name}`);
          return;
        }
        try {
          respond(id, await handler(args));
        } catch (e) {
          respondError(id, -32603, `Internal error: ${(e as Error).message}`);
        }
        return;
      }
      default:
        if (id !== undefined && id !== null) respondError(id, -32601, `Method not found: ${method}`);
    }
  }
}
