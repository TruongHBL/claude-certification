# Cấu hình chung của module CRM.
module CrmConfig
  MAX_CANDIDATES = 50
  FAVORITE_LIMIT = 200
  SESSION_TTL_HOURS = 2

  def self.feature_enabled?(name)
    ENV.fetch("CRM_FEATURES", "").split(",").include?(name.to_s)
  end
end
