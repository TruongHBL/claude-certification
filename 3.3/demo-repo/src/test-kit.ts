// Bộ test tối giản cho codebase mẫu (để file test typecheck được mà không cần thư viện ngoài).
export function describe(name: string, fn: () => void): void {
  console.log(name);
  fn();
}
export function it(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.log(`  ✗ ${name}: ${(e as Error).message}`);
  }
}
export function expectEqual<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`mong đợi ${String(expected)}, nhận ${String(actual)}`);
}
