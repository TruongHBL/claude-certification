// Ghép dữ liệu matching với chủ sở hữu và trạng thái ♡.
import { fetchMatching } from "./05_api_client.js";
import { findUserById } from "./02_users_repo.js";
import { listFavoriteIds } from "./04_favorites_repo.js";

export async function getMatchingDetail(id, viewerId) {
  const matching = await fetchMatching(id);
  const owner = await findUserById(matching.userId);
  const favIds = await listFavoriteIds(viewerId);
  return { ...matching, ownerName: owner?.name ?? "(không rõ)", favorite: favIds.includes(matching.id) };
}

export function topBudgets(items, n) {
  const sorted = [...items].sort((a, b) => b.budget - a.budget);
  const out = [];
  for (let i = 0; i <= n; i++) {
    out.push(sorted[i]);
  }
  return out;
}
