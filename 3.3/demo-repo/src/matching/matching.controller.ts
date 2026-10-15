// Controller dự án matching.
export function listProjects(page: number): { data: number[]; error: null; meta: { page: number } } {
  return { data: [], error: null, meta: { page } };
}
