# Kịch bản demo bài 1.7: Session management

**Thời lượng:** khoảng 15 phút (nói 5 phút, chạy lệnh 10 phút).
**Thông điệp chính:** file đã đổi mà vẫn *resume* phiên cũ thì agent dựa vào kết quả đọc cũ (stale context). Cách đúng là **mở phiên mới, đưa summary vào và nói rõ file nào đã đổi**. Đây là đáp án C của câu luyện tập.

---

## 0. Chuẩn bị trước giờ demo (5 phút, chưa tốn quota)

```bash
cd ~/Downloads/claude-cert/1.7/bai_1_7_session
claude auth status        # loggedIn: true
node -v                   # ≥ 22.6: run.sh đọc JSON/transcript bằng helper lib.ts
./run.sh reset            # tạo work/ từ codebase/, xoá out/
```

- Mở sẵn 3 tab:
  - Terminal ở thư mục trên.
  - `ANSWER_KEY.md`.
  - Trang `../bai-1.7-session-management.html`, mục 2 "Ba lựa chọn" và mục 3 "Bảng quyết định".
- Tăng cỡ chữ terminal. Mỗi bước chạy khoảng 0,5–2 phút với sonnet.
- Muốn rẻ hoặc nhanh hơn thì chạy `MODEL=haiku ./run.sh …`, nhưng haiku có thể ít lộ lỗi stale hơn.
- **Không bỏ được `--safe-mode`** (script bật mặc định). Cờ này tắt CLAUDE.md, plugin và hook của máy, để người xem thấy đúng hành vi gốc của Claude Code.

---

## 1. Mở đầu (2 phút, nói)

Chiếu mục 2 và 3 của trang HTML.

| Lựa chọn | Khi nào dùng | Lệnh |
|---|---|---|
| **Resume** | Context cũ vẫn đúng, chỉ tiếp tục | `claude --resume <id>` / `-c` |
| **Fork** | Muốn thử một hướng khác mà không phá phiên gốc | `--resume <id> --fork-session` |
| **Phiên mới + summary** | File đã đổi, kết quả tool cũ có thể sai | Phiên mới, prompt gồm summary và danh sách file đổi |

Câu chốt: *"Resume giữ nguyên mọi tool_result cũ trong context. Nếu file đã đổi, những kết quả đó là thông tin cũ."*

## 2. Bước 1: review 10 file (2 phút)

```bash
./run.sh step1
```

- Nói: codebase là module CRM, có 7 lỗi cài sẵn (chiếu bảng trong `ANSWER_KEY.md`).
- Chỉ ra dòng `session_id=…` trong output. Phiên có tên `cca-1-7-review`.
- Mở `out/step1.md` và lướt nhanh xem Claude bắt được những lỗi nào.

## 3. Bước 2: resume để viết summary (1 phút)

```bash
./run.sh step2
cat out/summary.md
```

- Nói: đây là **resume đúng chỗ**, vì file chưa đổi nên context cũ vẫn đúng.
- Summary là bảng File | Vấn đề | Mức độ | Đề xuất, chỉ có kết luận, không có code. Đây là thứ sẽ mang sang phiên mới.

## 4. Bước 3: sửa code ngoài phiên (30 giây)

```bash
./run.sh step3
cat out/diff_auth.rb.txt out/diff_middleware.rb.txt
```

Nói về 3 thay đổi:
- `auth.rb`: đã sửa `secure_compare` và **xoá hẳn `legacy_login`**.
- `session.rb`: đã đổi sang `SecureRandom`.
- `middleware.rb`: SQL injection **vẫn còn**, và có **lỗi mới**: log header `Authorization`.

## 5. Bước 4: resume phiên cũ sau khi file đổi (2 phút). Đây là điểm chính của demo

```bash
./run.sh step4
cat out/step4.md
```

Dấu hiệu stale cần chỉ ra (theo `ANSWER_KEY.md`):
- Nhắc `legacy_login` như thể vẫn còn.
- Đề xuất lại `secure_compare` / `SecureRandom`, tức là fix đã làm rồi.
- Không thấy lỗi mới (log `Authorization`).

> ⚠ **Có thể không ra stale context.** Claude Code tự phát hiện file mà phiên đã đọc bị sửa, có thể chèn nhắc nhở hoặc tự đọc lại. Mình chưa chạy thử nên chưa biết kết quả.
> Nếu Claude trả lời đúng, vẫn dùng được cho demo:
> - Chạy `./run.sh compare`, dòng cuối cho thấy step4 **đã Read lại** những file nào.
> - Nói: *"Ở đây Claude Code tự đọc lại vì công cụ có cơ chế phát hiện file đổi. Nhưng không phải agent hay harness nào cũng có cơ chế này (Agent SDK tự viết, Messages API), và resume vẫn tốn context cho kết quả cũ. Đề thi kiểm tra nguyên tắc, nên đáp án vẫn là phiên mới + summary."*

## 6. Bước 5: phiên mới, đưa summary và 3 file đã đổi (2 phút)

```bash
./run.sh step5
cat out/step5.md
```

Chỉ ra:
- Chỉ đọc 3 file đã đổi, 7 file kia giữ kết luận từ summary.
- Xác nhận A1 và S1 đã sửa, `legacy_login` không còn, SQL injection vẫn còn, và **bắt được lỗi mới**.

## 7. So sánh (1 phút)

```bash
./run.sh compare
```

- Bảng OK/FAIL cho step4 và step5, cùng danh sách file đã Read của từng phiên.
- Nếu còn thời gian, đọc vài dòng có nhắc `legacy_login` / `secure_compare` để cả nhóm tự chấm.

## 8. Bonus: fork (1 phút, có thể bỏ)

```bash
./run.sh step6
```

- Output in "Phiên gốc …: N → N dòng transcript", nghĩa là phiên gốc không đổi.
- Phiên fork có ID mới, khác ID gốc.
- Nói: fork để **thử hướng khác** (ví dụ thay Auth bằng Devise). Fork **không** dùng để chữa stale, vì nhánh fork vẫn mang context cũ.

## 9. Chốt (1 phút, nói)

- **File đã đổi** → phiên mới + summary + danh sách file đã đổi, không resume.
- **Context còn đúng** → resume.
- **Thử nhiều hướng** → fork.
- Bẫy đề: *"resume rồi bảo nó đọc lại file"* và *"fork để chữa stale"* đều sai, vì context cũ vẫn còn trong phiên.

---

## Nếu có sự cố

| Sự cố | Xử lý |
|---|---|
| `step2`/`step4` báo không tìm thấy phiên | Kiểm `cat .session_id`, phải chạy `step1` trước. Phiên gắn với thư mục `work/`, nên đừng `reset` giữa chừng |
| Một bước chạy quá lâu | Ctrl+C rồi chạy lại đúng bước đó. Các bước chạy độc lập |
| `subtype=error_max_budget_usd` | `BUDGET_USD=2 ./run.sh <bước>` |
| Không có mạng hoặc hết quota | Chiếu `ANSWER_KEY.md` (mục "Dấu hiệu stale" và "Kết quả mong đợi") và giảng bằng lời |
| Muốn chạy lại từ đầu | `./run.sh reset && ./run.sh all` |
