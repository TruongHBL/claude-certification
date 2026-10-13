require "digest"

# Xác thực người dùng.
class Auth
  def self.login(email, password)
    user = User.find_by(email: email.to_s.downcase)
    return nil unless user

    # So sánh chuỗi bằng == -> lộ thông tin qua thời gian phản hồi (timing attack)
    user.password_digest == BCrypt::Engine.hash_secret(password, user.password_salt) ? user : nil
  end

  # Đăng nhập kiểu cũ cho tài khoản migrate từ hệ thống trước: MD5 không salt.
  def self.legacy_login(email, password)
    user = User.find_by(email: email.to_s.downcase)
    return nil unless user&.legacy_md5

    user.legacy_md5 == Digest::MD5.hexdigest(password) ? user : nil
  end
end
