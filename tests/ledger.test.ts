import { beforeEach, describe, expect, it } from "vitest";
import { budgetPercent, calculateWalletBalance, equalJson, listDrafts, removeDraft, visibleBreakdown, writeDraft } from "../src/lib/ledger";

beforeEach(() => localStorage.clear());

describe("bản nháp và số liệu", () => {
  it("giữ các bản nháp độc lập theo tài khoản và thẻ trình duyệt", () => {
    const a = writeDraft(localStorage, "a", "tab1", 2, { entries: [1] });
    writeDraft(localStorage, "a", "tab2", 3, { entries: [2] });
    writeDraft(localStorage, "b", "tab1", 0, { entries: [3] });
    expect(listDrafts(localStorage, "a")).toHaveLength(2);
    expect(listDrafts(localStorage, "b")).toHaveLength(1);
    expect(() => removeDraft(localStorage, "b", a.key)).toThrow();
    removeDraft(localStorage, "a", a.key);
    expect(listDrafts(localStorage, "a")).toHaveLength(1);
  });
  it("nhận biết bản lưu đã thành công ngay cả khi JSONB đổi thứ tự khóa", () => {
    expect(equalJson({ x: 1, y: [{ a: 1, b: 2 }] }, { y: [{ b: 2, a: 1 }], x: 1 })).toBe(true);
    expect(equalJson({ x: [1, 2] }, { x: [2, 1] })).toBe(false);
  });
  it("không tính giao dịch tương lai vào số dư hiện tại", () => {
    expect(calculateWalletBalance(1000, "a", [
      { wallet: "a", date: "2026-11-17", amount: 100, type: "expense" },
      { wallet: "a", date: "2026-11-18", amount: 300, type: "expense" },
      { wallet: "b", date: "2026-11-17", amount: 500, type: "income" },
    ], "2026-11-17")).toBe(900);
  });
  it("tính đúng phần trăm vượt ngân sách và hiển thị đủ danh mục trong báo cáo", () => {
    expect(budgetPercent(150, 100)).toBe(150);
    expect(visibleBreakdown([1, 2, 3, 4, 5], false)).toHaveLength(4);
    expect(visibleBreakdown([1, 2, 3, 4, 5], true)).toHaveLength(5);
  });
});
