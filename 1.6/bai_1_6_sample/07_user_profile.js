// Hiển thị hồ sơ người dùng theo email.
import { findUserByEmail } from "./02_users_repo.js";

export async function profileHeader(email) {
  const user = await findUserByEmail(email);
  return `${user.name.toUpperCase()} <${user.email}>`;
}

export function initials(name) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2);
}
