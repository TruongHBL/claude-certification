// Controller /favorites (code mẫu).
import { addFavorite, listFavorites } from "./favorites_repo.ts";

export function postFavorite(body: { userId?: string; matchingId?: string }) {
  if (!body.userId || !body.matchingId) {
    return { status: 400, error: { errorCategory: "validation", isRetryable: false, description: "Thiếu userId hoặc matchingId" } };
  }
  return { status: 201, data: addFavorite({ userId: body.userId, matchingId: body.matchingId }) };
}

export function getFavorites(userId: string) {
  return { status: 200, data: listFavorites(userId) };
}
