# frozen_string_literal: true

# Shim RỖNG cho bản CLI: cho phép `require_relative "bai_1_6_multipass_review"` để tái dùng schema,
# hàm đọc file và bộ chấm của bản API mà không cần cài gem anthropic. Bản CLI không gọi Anthropic::Client.
