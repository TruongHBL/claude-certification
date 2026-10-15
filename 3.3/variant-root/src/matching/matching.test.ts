import { describe, expectEqual, it } from "../test-kit.ts";
import { listProjects } from "./matching.controller.ts";

describe("listProjects", () => {
  it("trả đúng số trang", () => expectEqual(listProjects(2).meta.page, 2));
  it("trả danh sách rỗng khi chưa có dự án", () => expectEqual(listProjects(1).data.length, 0));
});
