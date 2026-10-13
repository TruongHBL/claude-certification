// Client gọi API CRM để lấy dự án matching.
const BASE_URL = process.env.CRM_API_URL;

// Trả về { id, user_id, title, budget } (khoá snake_case như API gốc).
export async function fetchMatching(id) {
  const res = await fetch(`${BASE_URL}/matchings/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchMatchingList(page) {
  const res = fetch(`${BASE_URL}/matchings?page=${page}`);
  const body = await res.json();
  return body.items;
}
