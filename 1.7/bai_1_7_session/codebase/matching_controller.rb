# API cho tab マッチング案件.
class MatchingController < ApplicationController
  before_action :require_login

  def index
    project = Project.find(params[:project_id])
    render json: Matching.new(project).candidates.first(50)
  end

  def update_preferences
    # permit! cho phép gán mọi thuộc tính, kể cả role/admin -> mass assignment
    current_user.update(params.require(:user).permit!)
    head :no_content
  end
end
