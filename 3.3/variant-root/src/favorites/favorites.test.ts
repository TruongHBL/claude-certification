import { describe, expectEqual, it } from "../test-kit.ts";
import { toggleFavorite } from "./favorites.ts";

describe("toggleFavorite", () => {
  it("thêm khi chưa có", () => expectEqual(toggleFavorite([], "P1").length, 1));
  it("bỏ khi đã có", () => expectEqual(toggleFavorite(["P1"], "P1").length, 0));
});
