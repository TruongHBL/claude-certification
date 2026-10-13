# Người dùng hệ thống.
class User < ApplicationRecord
  has_many :favorites, dependent: :destroy
  has_many :skills, dependent: :destroy

  validates :email, presence: true, uniqueness: { case_sensitive: false }

  scope :active, -> { where(deleted_at: nil) }

  def display_name
    [last_name, first_name].compact.join(" ")
  end
end
