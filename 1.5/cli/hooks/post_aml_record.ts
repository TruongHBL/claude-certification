// PostToolUse(mcp__ops__aml_check): ghi state "AML pass" theo session_id + customer_id (để pre_aml_gate đọc).
import { appendJsonl, hookInput, readPayload } from "./lib.ts";

const inp = hookInput();
const r = readPayload(inp.tool_response);
if (r && r.aml === "pass") appendJsonl("aml_pass.jsonl", { session_id: inp.session_id, customer_id: r.customer_id });
