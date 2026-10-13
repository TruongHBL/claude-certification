// Điểm vào cho scripts/run-all-tests.ts (tìm <bài>/test/*.test.ts): chạy test run.sh nằm trong bai_1_7_session/.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "..", "bai_1_7_session", "test", "run_sh.test.ts")], { stdio: "inherit" });
process.exitCode = r.status ?? 1;
