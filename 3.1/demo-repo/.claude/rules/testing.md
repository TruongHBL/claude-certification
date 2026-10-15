# Quy ước test

Mã nhận diện file này (rule không có frontmatter `paths` nên nạp mọi phiên): CANARY-RULES-TESTING-4K

1. Đặt tên test theo mẫu `<hàm> – <tình huống> – <kết quả mong đợi>`.
2. Mỗi test chỉ một khẳng định chính, dùng `assert.deepStrictEqual` cho object.
3. Dữ liệu mẫu lấy từ `test/fixtures/`, không tạo dữ liệu ngẫu nhiên trong test.
