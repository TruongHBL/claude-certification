# Gửi thông báo khi có dự án mới khớp với người dùng.
class Notifier
  def initialize(mailer: UserMailer)
    @mailer = mailer
  end

  def notify(user, project)
    return if user.unsubscribed?

    @mailer.new_match(user_id: user.id, project_id: project.id).deliver_later
  end
end
