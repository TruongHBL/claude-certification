import { describe, expectEqual, it } from "../test-kit.ts";
import { getCustomer } from "./customers.ts";

describe("getCustomer", () => {
  it("trả data khi id hợp lệ", () => expectEqual(getCustomer("CUS-0001", "r1").data?.id, "CUS-0001"));
  it("trả lỗi VALIDATION khi id sai", () => expectEqual(getCustomer("x", "r2").error?.code, "VALIDATION"));
});
