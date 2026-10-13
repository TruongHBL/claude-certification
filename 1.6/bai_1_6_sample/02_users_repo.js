// Truy vấn bảng users.
import { query, queryOne } from "./01_db.js";

export async function findUserById(id) {
  return queryOne("SELECT id, name, email FROM users WHERE id = $1", [id]);
}

// Trả về null nếu không tìm thấy.
export async function findUserByEmail(email) {
  return queryOne("SELECT id, name, email FROM users WHERE email = '" + email + "'");
}

export async function listActiveUsers() {
  return query("SELECT id, name, email FROM users WHERE active = true ORDER BY id");
}
