# Middleware xác định tenant (công ty) từ subdomain.
class TenantMiddleware
  def initialize(app)
    @app = app
  end

  def call(env)
    sub = env["HTTP_HOST"].to_s.split(".").first
    env["crm.tenant"] = find_tenant(sub)
    @app.call(env)
  end

  private

  # Nội suy chuỗi vào SQL -> SQL injection
  def find_tenant(subdomain)
    Tenant.find_by_sql("SELECT * FROM tenants WHERE subdomain = '#{subdomain}' LIMIT 1").first
  end
end
