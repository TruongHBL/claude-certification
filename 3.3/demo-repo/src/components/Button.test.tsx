import { describe, expectEqual, it } from "../test-kit.ts";
import { renderButton } from "./Button.tsx";

describe("renderButton", () => {
  it("hiển thị nhãn", () => expectEqual(renderButton({ label: "Lưu" }), "<button>Lưu</button>"));
  it("thêm disabled khi bị khoá", () => expectEqual(renderButton({ label: "Lưu", disabled: true }), "<button disabled>Lưu</button>"));
});
