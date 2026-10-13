// PreToolUse(mcp__ops__transfer_funds): chỉ cho chuyển tiền khi phiên này đã có aml_check PASS cho đúng khách.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR, deny, hookInput } from "./lib.ts";

const inp = hookInput();
const cus = inp.tool_input?.customer_id;
const file = join(STATE_DIR, "aml_pass.jsonl");
const passed =
  existsSync(file) &&
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .some((l) => {
      const r = JSON.parse(l) as { session_id?: string; customer_id?: string };
      return r.session_id === inp.session_id && r.customer_id === cus;
    });
if (!passed) deny(`Chưa có aml_check PASS cho khách ${cus} trong phiên này. Gọi aml_check trước; nếu AML fail thì không được chuyển tiền.`);
