// Bảng favorites: (user_id, matching_id) duy nhất.
// v2: đổi sang tham số object để tránh truyền nhầm thứ tự.
import { query, queryOne } from "./01_db.js";

export async function addFavorite({ userId, matchingId }) {
  return queryOne(
    "INSERT INTO favorites (user_id, matching_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *",
    [userId, matchingId]
  );
}

export async function removeFavorite({ userId, matchingId }) {
  return query("DELETE FROM favorites WHERE user_id = $1 AND matching_id = $2", [userId, matchingId]);
}

export async function listFavoriteIds(userId) {
  const rows = await query("SELECT matching_id FROM favorites WHERE user_id = $1", [userId]);
  return rows.map((r) => r.matching_id);
}
