// Kết nối DB dùng chung cho các repo.
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// query(sql, params): luôn dùng tham số $1, $2... thay vì nối chuỗi.
export async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}
