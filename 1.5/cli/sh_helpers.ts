// Helper cho run_cli_hooks.sh (thay các đoạn `ruby -rjson -e …` cũ).
//   logged-in              đọc JSON của `claude auth status` từ stdin, exit 0 nếu loggedIn
//   mcp-config <server.ts> <ledger>   in file cấu hình MCP (server "ops" chạy bằng node)
//   show <pN.jsonl>        in tóm tắt stream-json: tool đã gọi, tool_result, kết quả cuối
import { readFileSync } from "node:fs";

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "logged-in": {
    let ok = false;
    try {
      ok = (JSON.parse(readFileSync(0, "utf8")) as { loggedIn?: boolean }).loggedIn === true;
    } catch {
      ok = false;
    }
    process.exit(ok ? 0 : 1);
  }
  case "mcp-config": {
    const [server, ledger] = args;
    const cfg = {
      mcpServers: {
        ops: { type: "stdio", command: process.execPath, args: ["--experimental-strip-types", "--no-warnings", server], env: { LEDGER_FILE: ledger } },
      },
    };
    console.log(JSON.stringify(cfg, null, 2));
    break;
  }
  case "show": {
    for (const line of readFileSync(args[0]!, "utf8").split("\n")) {
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      const content = m?.message?.content;
      for (const b of Array.isArray(content) ? content : []) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "tool_use") console.log(`  → gọi ${String(b.name).replace("mcp__ops__", "")} ${JSON.stringify(b.input)}`);
        if (b.type === "tool_result") {
          const c = Array.isArray(b.content) ? b.content.map((x: any) => x?.text ?? "").join("") : String(b.content ?? "");
          console.log(`    ${b.is_error ? "✗" : "←"} ${c.slice(0, 160)}`);
        }
      }
      if (m?.type === "result") console.log(`  KẾT QUẢ: ${String(m.result ?? "").slice(0, 300)}`);
    }
    break;
  }
  default:
    console.error("Dùng: sh_helpers.ts logged-in | mcp-config <server> <ledger> | show <file.jsonl>");
    process.exit(2);
}
