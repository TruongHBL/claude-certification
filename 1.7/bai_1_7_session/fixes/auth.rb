# Xác thực người dùng.
class Auth
  def self.login(email, password)
    user = User.find_by(email: email.to_s.downcase)
    return nil unless user

    expected = BCrypt::Engine.hash_secret(password, user.password_salt)
    ActiveSupport::SecurityUtils.secure_compare(user.password_digest, expected) ? user : nil
  end
  # legacy_login đã bị xoá: mọi tài khoản cũ đã được migrate sang bcrypt.
end
