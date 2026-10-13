# Báo cáo số lượt ♡ theo dự án trong một khoảng thời gian.
class FavoriteReport
  def initialize(from:, to:)
    @range = from.beginning_of_day..to.end_of_day
  end

  def rows
    Favorite.where(created_at: @range)
            .group(:project_id)
            .order(Arel.sql("COUNT(*) DESC"))
            .count
  end
end
