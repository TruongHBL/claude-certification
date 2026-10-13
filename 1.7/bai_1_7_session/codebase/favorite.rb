# Đánh dấu yêu thích (♡) một dự án.
class Favorite < ApplicationRecord
  belongs_to :user
  belongs_to :project

  # Không có validates :project_id, uniqueness: { scope: :user_id }
  # -> bấm ♡ hai lần sinh bản ghi trùng.

  def self.toggle(user, project)
    existing = find_by(user: user, project: project)
    existing ? existing.destroy : create(user: user, project: project)
  end
end
