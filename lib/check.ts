// Bộ test tối giản: check(tên, điều kiện) rồi summary() in "N PASS, M FAIL" và đặt exit code.
let pass = 0;
let fail = 0;

export function check(name: string, ok: boolean, detail = ""): boolean {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  → ${detail}` : ""}`);
  return ok;
}

export function section(title: string): void {
  console.log(`\n== ${title}`);
}

export function summary(): void {
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exitCode = fail === 0 ? 0 : 1;
}
