# frozen_string_literal: true

# load_document: bản THU HẸP của fetch_url (least privilege áp vào thiết kế tool).
#
# fetch_url tải BẤT KỲ URL nào → agent có thể gọi API nội bộ, tải ảnh/binary, chạm metadata cloud.
# load_document chỉ nhận tài liệu: https + domain đã duyệt + đuôi tài liệu. Vi phạm trả lỗi có
# cấu trúc theo quy ước bài 2.2 (errorCategory / isRetryable / description).

require "uri"
require "ipaddr"

module LoadDocument
  DOC_EXTENSIONS = %w[.pdf .docx .md .txt .html .htm].freeze
  TRUSTED_DOMAINS = %w[gso.gov.vn molisa.gov.vn ilo.org worldbank.org vnexpress.net hbr.org docs.example.vn].freeze
  BLOCKED_HOSTS = %w[localhost metadata.google.internal].freeze

  module_function

  def error(category, description)
    { isError: true, structuredContent: { errorCategory: category, isRetryable: false, description: description } }
  end

  def internal_ip?(host)
    ip = IPAddr.new(host)
    ip.loopback? || ip.private? || ip.link_local?
  rescue IPAddr::InvalidAddressError
    false
  end

  def trusted?(host)
    TRUSTED_DOMAINS.any? { |d| host == d || host.end_with?(".#{d}") }
  end

  # Trả nil nếu hợp lệ, hoặc Hash lỗi có cấu trúc.
  def validate(url)
    uri = URI.parse(url.to_s.strip)
    return error("validation", "URL không hợp lệ: '#{url}'. Cần URL https đầy đủ trỏ tới tài liệu.") unless uri.is_a?(URI::Generic) && uri.host

    host = uri.host.downcase
    return error("validation", "Chỉ nhận https (nhận được #{uri.scheme}). Tìm bản https của tài liệu.") unless uri.scheme == "https"
    if BLOCKED_HOSTS.include?(host) || internal_ip?(host)
      return error("permission", "Từ chối địa chỉ nội bộ '#{host}'. load_document không truy cập mạng nội bộ/metadata; không thử lại.")
    end
    return error("permission", "Domain '#{host}' chưa được duyệt. Báo coordinator nếu thật sự cần nguồn này.") unless trusted?(host)

    ext = File.extname(uri.path.to_s).downcase
    unless DOC_EXTENSIONS.include?(ext)
      shown = ext.empty? ? "(không có đuôi)" : ext
      return error("validation", "'#{shown}' không phải tài liệu. Chỉ nhận #{DOC_EXTENSIONS.join(' ')}. Dùng search_web để tìm bản tài liệu.")
    end
    nil
  rescue URI::InvalidURIError
    error("validation", "URL không parse được: '#{url}'.")
  end
end
