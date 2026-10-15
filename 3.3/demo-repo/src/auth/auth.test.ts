import { describe, expectEqual, it } from "../test-kit.ts";
import { isValidToken } from "./auth.ts";

describe("isValidToken", () => {
  it("chấp nhận token 32 ký tự", () => expectEqual(isValidToken("a".repeat(32)), true));
  it("từ chối token ngắn", () => expectEqual(isValidToken("abc"), false));
});
