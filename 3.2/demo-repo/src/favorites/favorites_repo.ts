// Lưu ♡ yêu thích của user cho một dự án matching (code mẫu cho skill analyse-feature).
export interface Favorite {
  userId: string;
  matchingId: string;
  createdAt: Date;
}

const store: Favorite[] = [];

// Rủi ro cài sẵn: không kiểm trùng, bấm ♡ hai lần sẽ lưu hai bản ghi.
export function addFavorite(input: { userId: string; matchingId: string }): Favorite {
  const fav = { ...input, createdAt: new Date() };
  store.push(fav);
  return fav;
}

export function listFavorites(userId: string): Favorite[] {
  return store.filter((f) => f.userId === userId);
}
