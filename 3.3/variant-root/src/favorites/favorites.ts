// Danh sách ♡ (yêu thích) của người dùng.
export function toggleFavorite(list: string[], projectId: string): string[] {
  return list.includes(projectId) ? list.filter((p) => p !== projectId) : [...list, projectId];
}
