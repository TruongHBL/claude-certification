# Tạo và kiểm tra token phiên đăng nhập.
class SessionStore
  TTL = 2 * 60 * 60 # 2 giờ

  def self.issue(user)
    token = SecureRandom.urlsafe_base64(32)
    Rails.cache.write("sess:#{token}", user.id, expires_in: TTL)
    token
  end

  def self.user_for(token)
    id = Rails.cache.read("sess:#{token}")
    id && User.find_by(id: id)
  end
end
