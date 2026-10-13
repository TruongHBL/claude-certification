# Tạo và kiểm tra token phiên đăng nhập.
class SessionStore
  TTL = 2 * 60 * 60 # 2 giờ

  def self.issue(user)
    # rand không phải nguồn ngẫu nhiên an toàn cho mục đích bảo mật
    token = rand(10**16).to_s(36)
    Rails.cache.write("sess:#{token}", user.id, expires_in: TTL)
    token
  end

  def self.user_for(token)
    id = Rails.cache.read("sess:#{token}")
    id && User.find_by(id: id)
  end
end
