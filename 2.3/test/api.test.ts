// Kiểm thử bài 2.3 (bản Messages API). Chạy: node --experimental-strip-types test/api.test.ts
// Phần config_check, load_document, payload tool_choice, audit là kiểm thử THẬT (code tất định).
// Phần end-to-end dùng StubClient (GIẢ LẬP Claude theo kịch bản).
import { check, section, summary } from "../../lib/check.ts";
import { AGENTS, DOC_ANALYSIS_TOOLS, WEB_SEARCH_TOOLS, allowedNames, tool, type AgentConfig, type Role } from "../tool_config.ts";
import { checks as configChecks } from "../config_check.ts";
import { validate } from "../load_document.ts";
import { MockWorld, Runner, StubClient, buildPayload, verifyLog } from "../multi_agent_run.ts";

section("config_check");
for (const r of configChecks()) check(`config: ${r.name}`, r.ok);

// Cấu hình hỏng phải bị bắt: thêm search_web vào synthesis, đưa extract_metadata cho coordinator, thêm fetch_url.
const bad = Object.fromEntries(Object.entries(AGENTS).map(([k, v]) => [k, { ...v }])) as Record<Role, AgentConfig>;
bad.synthesis.tools = [...bad.synthesis.tools, WEB_SEARCH_TOOLS[0]];
bad.coordinator.tools = [...bad.coordinator.tools, DOC_ANALYSIS_TOOLS[0]];
bad.web_search.tools = [...bad.web_search.tools, tool("fetch_url", "x".repeat(50), {}, []), tool("extra_one", "y".repeat(50), {}, [])];
const failed = configChecks(bad).filter((r) => !r.ok).map((r) => r.name);
check("config hỏng: bắt tool trùng role", failed.some((n) => n.includes("trùng")));
check("config hỏng: bắt fetch_url", failed.some((n) => n.includes("fetch_url")));
check("config hỏng: bắt coordinator giữ tool nghiệp vụ", failed.some((n) => n.includes("coordinator")));
check("config hỏng: bắt web_search 6 tool", failed.some((n) => n.startsWith("web_search: 4–5")));

section("load_document");
const urls: [string, string | null][] = [
  ["https://www.gso.gov.vn/bao-cao-lao-dong-2026.pdf", null],
  ["https://www.ilo.org/hybrid-work-asia-2025.pdf", null],
  ["https://hbr.org/2026/03/hybrid.html", null],
  ["https://docs.example.vn/docs/chinh-sach-hybrid-v2.md", null],
  ["http://www.gso.gov.vn/bao-cao.pdf", "validation"],
  ["https://www.gso.gov.vn/images/chart.png", "validation"],
  ["https://www.gso.gov.vn/api/stats.json", "validation"],
  ["https://www.gso.gov.vn/api/stats", "validation"],
  ["https://localhost/report.pdf", "permission"],
  ["https://169.254.169.254/latest/meta-data/iam.txt", "permission"],
  ["https://10.0.0.5/secret.pdf", "permission"],
  ["https://evil.example.com/report.pdf", "permission"],
  ["https://gso.gov.vn.evil.com/report.pdf", "permission"],
  ["không phải url", "validation"],
];
for (const [url, want] of urls) {
  const e = validate(url);
  const got = e ? e.structuredContent.errorCategory : null;
  const ok = got === want && (e === null ||
    (e.isError === true && e.structuredContent.isRetryable === false && e.structuredContent.description.length > 20));
  check(`load_document ${url} → ${want ?? "hợp lệ"}`, ok);
}

section("payload tool_choice");
const p1 = buildPayload("doc_analysis", 1, []);
const p2 = buildPayload("doc_analysis", 2, []);
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
check("doc_analysis lượt 1: tool_choice {type: tool, name: extract_metadata}", eq(p1.tool_choice, { type: "tool", name: "extract_metadata" }));
check("doc_analysis lượt 2: tool_choice auto", eq(p2.tool_choice, { type: "auto" }));
check("synthesis: tool_choice any", eq(buildPayload("synthesis", 3, []).tool_choice, { type: "any" }));
check("web_search: tool_choice auto", eq(buildPayload("web_search", 1, []).tool_choice, { type: "auto" }));
check("payload chỉ gửi đúng bộ tool của agent", eq(p1.tools?.map((t) => t.name), allowedNames("doc_analysis")));
const thinking = { type: "enabled" as const, budget_tokens: 2048 };
const throws = (f: () => unknown) => { try { f(); return false; } catch (e) { return e instanceof RangeError; } };
check("forced + extended thinking bị từ chối", throws(() => buildPayload("doc_analysis", 1, [], { thinking })));
check("any + extended thinking bị từ chối", throws(() => buildPayload("synthesis", 1, [], { thinking })));
check("auto + extended thinking được phép", eq(buildPayload("doc_analysis", 2, [], { thinking }).thinking, thinking));

section("verify_fact (scoped)");
const w = new MockWorld();
w.execute("save_snippet", { url: StubClient.GSO, quote: "62% doanh nghiệp văn phòng áp dụng hybrid", location: "tr. 14" });
let [r, err] = w.execute("verify_fact", { fact: "62% doanh nghiệp áp dụng hybrid", source_url: StubClient.GSO });
check("dữ kiện đơn 1 nguồn → verified", !err && r.verified === true && r.location === "tr. 14");
[r, err] = w.execute("verify_fact", { fact: StubClient.COMPLEX, source_url: StubClient.ILO });
check("nhận định so sánh → lỗi business, chuyển coordinator", err && r.errorCategory === "business" && r.description.includes("coordinator"));

section("audit");
let runner = new Runner(new StubClient());
const [content, isErr] = await runner.dispatch("synthesis", "synthesis#1", allowedNames("synthesis"), { name: "search_web", input: { query: "x" } });
check("tool ngoài bộ → is_error permission", isErr && content.errorCategory === "permission");
check("tool ngoài bộ → ghi vi phạm, không thực thi", runner.violations.length === 1 && runner.world.snippets.length === 0);

section("end-to-end (STUB)");
runner = new Runner(new StubClient());
const final = await runner.run();
let [checks, used] = verifyLog(runner);
for (const c of checks) check(`e2e: ${c.name}`, c.ok);
check("e2e: web_search bị load_document từ chối ảnh .png",
  runner.log.some((e) => e.type === "tool_error" && e.tool === "load_document" && e.error.errorCategory === "validation"));
check("e2e: coordinator chỉ dùng Agent/review_output",
  (used.coordinator ?? []).every((n) => ["Agent", "review_output", "request_revision"].includes(n)));
check("e2e: câu trả lời cuối có nguồn và giới hạn số liệu", final.includes("GSO") && final.includes("tự đánh giá"));

section("misuse demo (STUB)");
runner = new Runner(new StubClient({ misuseDemo: true }));
await runner.run();
[checks] = verifyLog(runner);
check("misuse: audit ghi đúng 1 vi phạm synthesis→search_web",
  eq(runner.violations.map((v) => `${v.agent}→${v.tool}`), ["synthesis→search_web"]));
check("misuse: kiểm tra 'không vi phạm' báo FAIL", checks.find((c) => c.name === "không có vi phạm audit")?.ok === false);
check("misuse: synthesis vẫn hoàn tất compile_report sau khi bị chặn",
  runner.log.some((e) => !e.type && e.agent === "synthesis" && e.tool_calls.includes("compile_report")));

summary();
