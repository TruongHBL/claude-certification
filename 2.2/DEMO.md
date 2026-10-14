# Demo: gọi tool bị lỗi (bài 2.2)

Ba mức demo, từ không tốn gì đến có Claude thật. Chạy trong `~/Downloads/claude-cert/2.2`.

## Mức 1. Xem lỗi "thô" mà server trả về (không cần model, 1 phút)

Gửi thẳng JSON-RPC vào MCP server để thấy **2 lớp lỗi** và **4 loại lỗi**:

```bash
rpc() { printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' "$1" \
  | node --experimental-strip-types --no-warnings support_mcp_server.ts | tail -1 | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s),null,2)))'; }
call() { rpc "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"; }

call get_customer '{"customer_id":"CUS-9999"}'                       # rỗng hợp lệ: isError KHÔNG có, resultCount 0
call get_customer '{"customer_id":"CUS-0042","simulate":"timeout"}'  # transient   · isRetryable true
call get_customer '{"customer_id":"cus 12"}'                         # validation  · sửa input rồi gọi lại
call process_refund '{"customer_id":"CUS-0012","amount":750}'        # business    · không retry, escalate
call get_customer '{"customer_id":"CUS-0777"}'                       # permission  · xin quyền / escalate
call xoa_khach '{}'                                                  # lỗi GIAO THỨC: JSON-RPC error -32602
```

Điểm cần chỉ:
- 5 lệnh đầu là **lỗi khi chạy tool**: vẫn là `result`, có `isError: true`, kèm `structuredContent` gồm `errorCategory`, `isRetryable`, `description`. Riêng lệnh rỗng hợp lệ thì không có `isError`.
- Lệnh cuối là **lỗi giao thức**: không có `result`, chỉ có `error.code`. Model không bao giờ thấy loại lỗi này.
- So với kiểu cũ: thêm `ERROR_STYLE=bad ` trước `node` trong hàm `rpc`, mọi lỗi chỉ còn chữ `"Error"`, và kết quả rỗng trông y như lỗi.

## Mức 2. Agent bằng code rẽ nhánh theo metadata (không cần model, 1 phút)

```bash
BACKOFF_SCALE=0.3 node --experimental-strip-types --no-warnings recovery_agent.ts
```

- Chỉ ra kịch bản DB sập: retry 3 lần với thời gian chờ tăng dần, rồi mới báo lên.
- Chỉ ra dòng tổng: **16 lần gọi** (có cấu trúc) so với **30 lần** (kiểu `"Error"`).

## Mức 3. Claude thật tự xử lý lỗi (tốn vài cent, khoảng 3–5 phút)

```bash
./run_llm.sh all      # 5 prompt × 2 kiểu lỗi = 10 lệnh claude -p (haiku)
./run_llm.sh report   # bảng: số lần gọi tool, tool đã gọi, câu trả lời cuối
```

| Prompt | Lỗi gặp phải | Hành vi đúng |
|---|---|---|
| p0 "Tra hồ sơ khách CUS-9999" | Rỗng hợp lệ | Gọi 1 lần, trả lời "không có khách này" |
| p1 "Hoàn 750 USD" | business | Không gọi lại, đề nghị quản lý duyệt |
| p2 "Xem số dư CUS-0777" | permission | Không gọi lại, báo cần quyền cao hơn |
| p3 "Tra khách cus 12" | validation | Tự sửa thành `CUS-0012` rồi gọi lại |
| p4 "simulate=flaky:2" | transient 2 lần | Gọi lại, thành công ở lần 3 |

So cột "số lần gọi tool" giữa `structured` và `bad`. Với kiểu `bad`, Claude chỉ thấy `"Error"` nên phải đoán.
Ghi chú: Claude thật có thể xử lý khác bảng trên. Ghi lại kết quả thật và dùng chính nó để thảo luận.

## Bonus: lỗi tool có sẵn của Claude Code (chạy trong phiên `claude` tương tác)

| Gõ cho Claude | Lỗi Claude nhận về | Ứng với |
|---|---|---|
| "Đọc file /tmp/khong-co.txt" | `Read`: file không tồn tại | Rỗng hoặc input sai: Claude không đọc lại y nguyên, sẽ hỏi hoặc tìm file |
| "Chạy lệnh `ls /khong-co`" | `Bash` trả exit code ≠ 0 kèm stderr | Lỗi khi chạy tool: Claude đọc stderr rồi quyết định |
| `/mcp` rồi gọi một tool Notion | Server "Needs authentication" | permission: phải đăng nhập, thử lại vô ích |
