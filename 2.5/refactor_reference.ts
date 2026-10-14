// "Refactor chuẩn" cho codebase mẫu: danh sách lệnh Edit theo đúng thứ tự một agent làm tốt sẽ làm,
// kèm mô phỏng ngữ nghĩa tool Edit của Claude Code (old_string phải khớp DUY NHẤT, trừ khi replace_all).
// Dùng trong test (áp lên bản sao để verify) và trong claude giả (phát stream-json kịch bản "good").
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface EditCall {
  file_path: string; // tương đối so với thư mục làm việc
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

// Thông báo thật của Claude Code 2.1.299 khi old_string khớp nhiều chỗ (lấy từ binary, ${n} = số chỗ khớp).
export const nonUniqueMessage = (n: number) =>
  `Found ${n} matches of the string to replace, but replace_all is false. To replace all occurrences, ` +
  `set replace_all to true. To replace only one occurrence, please provide more context to uniquely identify the instance.`;

export function applyEdit(root: string, e: EditCall): { ok: boolean; message: string } {
  const path = join(root, e.file_path);
  const text = readFileSync(path, "utf8");
  const n = text.split(e.old_string).length - 1;
  if (n === 0) return { ok: false, message: "String to replace not found in file." };
  if (n > 1 && !e.replace_all) return { ok: false, message: nonUniqueMessage(n) };
  writeFileSync(path, e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string));
  return { ok: true, message: `The file ${e.file_path} has been updated.` };
}

const NEW_IMPORT = 'import { processOrder } from "../orders/process.ts";';

export const REFERENCE_EDITS: EditCall[] = [
  // Gọi trực tiếp
  { file_path: "src/checkout/checkout_service.ts", old_string: 'import { processLegacyOrder } from "../orders/legacy.ts";', new_string: NEW_IMPORT },
  { file_path: "src/checkout/checkout_service.ts", old_string: "processLegacyOrder(cart.orderId)", new_string: "processOrder(cart.orderId, { validate: true })" },
  { file_path: "src/crm/customer_reorder.ts", old_string: 'import { processLegacyOrder } from "../orders/legacy.ts";', new_string: NEW_IMPORT },
  { file_path: "src/crm/customer_reorder.ts", old_string: "processLegacyOrder(previousOrderId)", new_string: "processOrder(previousOrderId, { validate: true })" },
  { file_path: "src/admin/bulk_reprocess.ts", old_string: 'import { processLegacyOrder } from "../orders/legacy.ts";', new_string: NEW_IMPORT },
  // Bẫy: 2 dòng giống hệt nhau → lần đầu lỗi non-unique, lần sau dùng replace_all
  { file_path: "src/admin/bulk_reprocess.ts", old_string: "results.push(processLegacyOrder(id));", new_string: "results.push(processOrder(id, { validate: true }));" },
  { file_path: "src/admin/bulk_reprocess.ts", old_string: "results.push(processLegacyOrder(id));", new_string: "results.push(processOrder(id, { validate: true }));", replace_all: true },
  // Qua wrapper: sửa thân wrapper (job nightly_sync gọi wrapper nên tự động dùng API mới)
  { file_path: "src/orders/apply.ts", old_string: 'import { processLegacyOrder } from "./legacy.ts";', new_string: 'import { processOrder } from "./process.ts";' },
  { file_path: "src/orders/apply.ts", old_string: "return processLegacyOrder(order.id);", new_string: "return processOrder(order.id, { validate: true });" },
  // Qua barrel đổi tên: consumer chỉ biết tên submitLegacyOrder
  {
    file_path: "src/api/order_routes.ts",
    old_string: 'import { submitLegacyOrder, formatCurrency } from "../utils/index.ts";',
    new_string: 'import { formatCurrency } from "../utils/index.ts";\n' + NEW_IMPORT,
  },
  { file_path: "src/api/order_routes.ts", old_string: "submitLegacyOrder(req.orderId)", new_string: "processOrder(req.orderId, { validate: true })" },
  { file_path: "src/utils/index.ts", old_string: '\nexport { processLegacyOrder as submitLegacyOrder } from "../orders/legacy.ts";', new_string: "" },
];

// File gọi hàm deprecated (trực tiếp, qua wrapper, qua barrel). nightly_sync.ts chỉ gọi wrapper:
// sửa wrapper (apply.ts) HOẶC sửa nightly_sync.ts đều được tính.
export const CALLER_GROUPS: string[][] = [
  ["src/checkout/checkout_service.ts"],
  ["src/crm/customer_reorder.ts"],
  ["src/admin/bulk_reprocess.ts"],
  ["src/api/order_routes.ts"],
  ["src/orders/apply.ts", "src/jobs/nightly_sync.ts"],
];

export const RELATED_TESTS = [
  "src/checkout/checkout_service.test.ts",
  "src/crm/customer_reorder.test.ts",
  "src/admin/bulk_reprocess.test.ts",
  "src/api/order_routes.test.ts",
  "src/jobs/nightly_sync.test.ts",
];
