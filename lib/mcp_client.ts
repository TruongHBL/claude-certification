// Client MCP stdio tối giản: spawn server, gửi request, chờ response theo id.
// Dùng trong test và trong các agent tự viết (vd bài 2.2).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export interface RpcResponse {
  jsonrpc: "2.0";
  id: number | null;
  result?: any;
  error?: { code: number; message: string };
}

export class McpClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, (r: RpcResponse) => void>();

  constructor(command: string, args: string[], env: Record<string, string> = {}) {
    this.proc = spawn(command, args, { env: { ...process.env, ...env } });
    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line) as RpcResponse;
      const cb = msg.id != null ? this.pending.get(msg.id) : undefined;
      if (cb) {
        this.pending.delete(msg.id as number);
        cb(msg);
      }
    });
  }

  /** Spawn một server .ts bằng chính node đang chạy (có --experimental-strip-types). */
  static forTsServer(path: string, env: Record<string, string> = {}): McpClient {
    return new McpClient(process.execPath, ["--experimental-strip-types", "--no-warnings", path], env);
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<RpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  /** Gửi một dòng thô (để test JSON hỏng). */
  sendRaw(line: string): void {
    this.proc.stdin.write(line + "\n");
  }

  async initialize(): Promise<RpcResponse> {
    const r = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    this.notify("notifications/initialized");
    return r;
  }

  callTool(name: string, args: Record<string, unknown> = {}): Promise<RpcResponse> {
    return this.request("tools/call", { name, arguments: args });
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}
