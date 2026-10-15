import { describe, expectEqual, it } from "../test-kit.ts";
import { formatYen } from "./format.ts";

describe("formatYen", () => {
  it("làm tròn và thêm dấu phân cách", () => expectEqual(formatYen(1234.6), "¥1,235"));
  it("trả ¥0 khi số tiền bằng 0", () => expectEqual(formatYen(0), "¥0"));
});
