// Mã nguồn giả của repo team: Grep tìm thấy TÊN bảng ở đây nhưng không có DỮ LIỆU hay schema đầy đủ.
export async function listFavorites(db, userId) {
  return db.query("SELECT project_id FROM favorites WHERE user_id = ?", [userId]);
}
