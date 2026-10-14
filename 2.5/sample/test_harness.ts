// Bộ test tối giản cho codebase mẫu: test(tên, hàm) đăng ký, run_tests.ts chạy.
export const registry: { name: string; fn: () => void }[] = [];

export function test(name: string, fn: () => void): void {
  registry.push({ name, fn });
}
