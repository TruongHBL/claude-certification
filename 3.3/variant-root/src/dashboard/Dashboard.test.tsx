import { describe, expectEqual, it } from "../test-kit.ts";
import { countByStatus } from "./Dashboard.tsx";

describe("countByStatus", () => {
  it("đếm đúng từng trạng thái", () => expectEqual(countByStatus(["open", "open", "matched"]).open, 2));
  it("trả 0 khi danh sách rỗng", () => expectEqual(countByStatus([]).closed, 0));
});
