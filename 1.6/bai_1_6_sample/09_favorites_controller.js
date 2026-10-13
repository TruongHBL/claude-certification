// API ♡: POST/DELETE /matchings/:id/favorite
import { addFavorite, removeFavorite } from "./04_favorites_repo.js";

export async function postFavorite(req, res) {
  if (!req.user) return res.status(401).json({ error: "unauthorized" });
  const row = await addFavorite(req.user.id, Number(req.params.id));
  return res.status(201).json({ favorite: row !== null });
}

export async function deleteFavorite(req, res) {
  if (!req.user) return res.status(401).json({ error: "unauthorized" });
  await removeFavorite({ userId: req.user.id, matchingId: Number(req.params.id) });
  return res.status(204).end();
}
