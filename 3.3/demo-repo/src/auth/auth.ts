// Xác thực đơn giản cho CRM.
export function isValidToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(token);
}
