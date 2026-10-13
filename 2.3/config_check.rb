# frozen_string_literal: true

# Kiểm tra tĩnh cấu hình phân bổ tool (chạy thật, tất định, không gọi model).
# Chạy: ruby config_check.rb

require_relative "tool_config"

module ConfigCheck
  GENERIC_NAMES = %w[fetch_url analyze analyze_document analyze_content process run do_task
                     execute get_data handle helper tool search].freeze
  SUBAGENTS = %w[web_search doc_analysis synthesis].freeze

  module_function

  def checks(agents = ToolConfig::AGENTS, scoped = ToolConfig::SCOPED_CROSS_ROLE)
    out = []
    add = ->(name, ok, detail) { out << { name: name, ok: ok, detail: detail } }

    SUBAGENTS.each do |a|
      n = agents[a][:tools].size
      add.("#{a}: 4–5 tool", (4..5).cover?(n), "#{n} tool")
    end

    owners = Hash.new { |h, k| h[k] = [] }
    agents.each { |a, cfg| cfg[:tools].each { |t| owners[t[:name]] << a } }
    dup = owners.select { |name, list| list.size > 1 && !scoped.key?(name) }
    add.("không tool nào trùng giữa các role (trừ scoped)", dup.empty?, dup.empty? ? "OK" : dup.inspect)

    scoped.each do |name, meta|
      owner_ok = owners[name] == [meta[:owner]]
      desc = agents[meta[:owner]][:tools].find { |t| t[:name] == name }&.dig(:description).to_s
      add.("scoped #{name} chỉ ở #{meta[:owner]} và mô tả có giới hạn",
           owner_ok && desc.include?("[SCOPED]") && desc.include?("coordinator"),
           "owner=#{owners[name].inspect}")
    end

    all_names = owners.keys
    generic = all_names & GENERIC_NAMES
    add.("không có tên tool chung chung / fetch_url", generic.empty?, generic.empty? ? "OK" : generic.inspect)

    domain = SUBAGENTS.flat_map { |a| agents[a][:tools].map { |t| t[:name] } }
    leaked = agents["coordinator"][:tools].map { |t| t[:name] } & domain
    add.("coordinator không giữ tool nghiệp vụ", leaked.empty?, leaked.empty? ? "OK" : leaked.inspect)

    missing_desc = all_names.select { |n| agents.values.flat_map { |c| c[:tools] }.find { |t| t[:name] == n }[:description].to_s.size < 40 }
    add.("mọi tool có mô tả ≥ 40 ký tự", missing_desc.empty?, missing_desc.empty? ? "OK" : missing_desc.inspect)

    first = agents["doc_analysis"][:tool_choice].call(1)
    second = agents["doc_analysis"][:tool_choice].call(2)
    add.("doc_analysis: lượt 1 ép extract_metadata, lượt 2 auto",
         first == { type: "tool", name: "extract_metadata" } && second == { type: "auto" },
         "#{first.inspect} → #{second.inspect}")
    out
  end
end

if $PROGRAM_NAME == __FILE__
  rows = ConfigCheck.checks
  puts "== Bảng tool theo agent =="
  ToolConfig::AGENTS.each do |a, cfg|
    names = cfg[:tools].map { |t| ToolConfig::SCOPED_CROSS_ROLE.key?(t[:name]) ? "#{t[:name]}*" : t[:name] }
    puts format("  %-13s %d tool  %s", a, names.size, names.join(", "))
  end
  puts "  (* = scoped cross-role)"
  puts "\n== Kiểm tra =="
  rows.each { |r| puts "  #{r[:ok] ? 'PASS' : 'FAIL'}  #{r[:name]}  [#{r[:detail]}]" }
  failed = rows.count { |r| !r[:ok] }
  puts "\n#{rows.size - failed}/#{rows.size} đạt"
  exit(failed.zero? ? 0 : 1)
end
