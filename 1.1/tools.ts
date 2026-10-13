// Bài 1.1 – hai tool dùng chung cho bản API (bai_1_1_agentic_loop.ts) và bản CLI (loop_mcp_server.ts):
// web_search (dữ liệu giả lập) và calculator (parser đệ quy, không dùng eval).

export const TOOL_SPECS = [
  {
    name: "web_search",
    description:
      "Tìm số liệu thực tế (dân số, diện tích...) về một chủ đề. " +
      "Dùng khi cần dữ kiện chưa có trong hội thoại. Trả về một đoạn văn ngắn có số liệu.",
    schema: {
      type: "object",
      properties: { query: { type: "string", description: "Câu truy vấn, ví dụ 'dân số Hà Nội 2024'" } },
      required: ["query"],
    },
  },
  {
    name: "calculator",
    description: "Tính biểu thức số học gồm + - * / và dấu ngoặc. Dùng cho MỌI phép tính thay vì tự tính nhẩm.",
    schema: {
      type: "object",
      properties: { expression: { type: "string", description: "Biểu thức, ví dụ '(9.5 - 8.7) / 8.7 * 100'" } },
      required: ["expression"],
    },
  },
] as const;

// Dữ liệu GIẢ LẬP cho bài tập (không phải số liệu chính thức).
const MOCK_FACTS: [string, string][] = [
  ["hà nội", "Dân số Hà Nội năm 2024 khoảng 8,7 triệu người (số liệu giả lập)."],
  ["hồ chí minh", "Dân số TP. Hồ Chí Minh năm 2024 khoảng 9,5 triệu người (số liệu giả lập)."],
  ["hcm", "Dân số TP. Hồ Chí Minh năm 2024 khoảng 9,5 triệu người (số liệu giả lập)."],
];

export function webSearch(query: string): string {
  const q = query.toLowerCase();
  const hit = MOCK_FACTS.find(([k]) => q.includes(k));
  return hit ? hit[1] : `Không tìm thấy kết quả cho '${query}'.`;
}

export class CalcError extends Error {}

const TOKEN = /\d+(?:[.,]\d+)?|[-+*/()]/g;

// Parser đệ quy nhỏ cho + - * / ( ) — không dùng eval.
export function evaluate(str: string): number {
  const tokens = (str.match(TOKEN) ?? []).map((t) => t.replace(",", "."));
  const rest = str.replace(TOKEN, "").replace(/\s/g, "");
  if (rest) throw new CalcError(`ký tự không hợp lệ: ${rest}`);

  const expr = (): number => {
    let v = term();
    while (tokens[0] === "+" || tokens[0] === "-") v = tokens.shift() === "+" ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (tokens[0] === "*" || tokens[0] === "/") {
      if (tokens.shift() === "*") v *= factor();
      else {
        const d = factor();
        if (d === 0) throw new CalcError("chia cho 0");
        v /= d;
      }
    }
    return v;
  };
  const factor = (): number => {
    const t = tokens.shift();
    if (t === undefined) throw new CalcError("biểu thức chưa đầy đủ");
    if (t === "(") {
      const v = expr();
      if (tokens.shift() !== ")") throw new CalcError("thiếu ')'");
      return v;
    }
    if (t === "-") return -factor();
    if (t === "+") return factor();
    const n = Number(t);
    if (Number.isNaN(n)) throw new CalcError(`token không hợp lệ: ${t}`);
    return n;
  };

  const v = expr();
  if (tokens.length) throw new CalcError(`thừa token: ${tokens.join("")}`);
  return v;
}

/** Làm tròn 4 chữ số, in giống bản gốc (số nguyên vẫn có ".0"). */
export function formatNumber(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  return Number.isInteger(r) ? `${r}.0` : String(r);
}

/** Chạy một tool theo tên. Trả [output, isError]; lỗi input trả về để Claude tự sửa. */
export function runTool(name: string, input: Record<string, unknown>): [string, boolean] {
  try {
    switch (name) {
      case "web_search":
        return [webSearch(String(input.query ?? "")), false];
      case "calculator":
        return [formatNumber(evaluate(String(input.expression ?? ""))), false];
      default:
        return [`Tool không tồn tại: ${name}`, true];
    }
  } catch (e) {
    if (e instanceof CalcError) return [`Lỗi: ${e.message}`, true];
    throw e;
  }
}
