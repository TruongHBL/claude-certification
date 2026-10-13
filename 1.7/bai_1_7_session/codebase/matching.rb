# Tìm ứng viên phù hợp cho một dự án (案件) dựa trên kỹ năng.
class Matching
  def initialize(project)
    @project = project
  end

  # Trả về danh sách hash {user, score} sắp theo điểm giảm dần.
  def candidates
    User.active.map do |user|
      # Mỗi user lại query skills riêng -> N+1 query
      skills = Skill.where(user_id: user.id).pluck(:name)
      { user: user, score: score(skills) }
    end.sort_by { |c| -c[:score] }
  end

  private

  def score(skills)
    (skills & @project.required_skills).size
  end
end
