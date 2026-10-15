// Dịch vụ matching (code mẫu, không liên quan favorites: để skill phải lọc).
export interface MatchingProject {
  id: string;
  title: string;
  budget: number;
}

export function topBudgets(projects: MatchingProject[], n: number): MatchingProject[] {
  return [...projects].sort((a, b) => b.budget - a.budget).slice(0, n);
}
