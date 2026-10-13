// Tìm dự án theo từ khoá, cho phép sắp xếp.
import { query } from "./01_db.js";

const DEFAULT_SORT = "created_at DESC";

export async function searchMatchings(keyword, sort) {
  const orderBy = sort || DEFAULT_SORT;
  return query(
    "SELECT id, title, budget FROM matchings WHERE title ILIKE $1 ORDER BY " + orderBy,
    [`%${keyword}%`]
  );
}
