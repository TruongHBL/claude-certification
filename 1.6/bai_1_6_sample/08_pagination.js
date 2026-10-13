// Tính phân trang cho danh sách.
export function paginate(total, perPage, page) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), totalPages);
  const offset = (current - 1) * perPage;
  return { totalPages, current, offset, limit: perPage };
}

export function hasNext({ current, totalPages }) {
  return current < totalPages;
}
