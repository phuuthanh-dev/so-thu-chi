import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BriefcaseBusiness, CarFront, Gift, HeartPulse, ShoppingBag, Tag, UtensilsCrossed } from "lucide-react";
import { categoryAppearance } from "../src/lib/category-icons";
import { CategoryIcon } from "../src/app/category-icon";

describe("biểu tượng danh mục", () => {
  it("chọn biểu tượng và màu phù hợp với nhóm chi và thu", () => {
    expect(categoryAppearance("Ăn uống", "expense").icon).toBe(UtensilsCrossed);
    expect(categoryAppearance("Quần áo", "expense").icon).toBe(ShoppingBag);
    expect(categoryAppearance("Đi lại", "expense").icon).toBe(CarFront);
    expect(categoryAppearance("Sức khỏe", "expense").icon).toBe(HeartPulse);
    expect(categoryAppearance("Lương", "income").icon).toBe(BriefcaseBusiness);
    expect(categoryAppearance("Tiền thưởng", "income").icon).toBe(Gift);
    expect(new Set(["Ăn uống", "Quần áo", "Đi lại", "Sức khỏe"].map(name => categoryAppearance(name, "expense").color)).size).toBe(4);
  });
  it("nhận diện tên tùy chỉnh không dấu và dùng màu ổn định nếu chưa nhận diện", () => {
    expect(categoryAppearance("Chi phí CÀ PHÊ", "expense")).toEqual(categoryAppearance("Chi phi ca phe", "expense"));
    const first = categoryAppearance("Quỹ đặc biệt", "expense");
    expect(first.icon).toBe(Tag);
    expect(categoryAppearance("Quỹ đặc biệt", "expense")).toEqual(first);
    expect(first.color).not.toBe(first.background);
  });
  it("giữ icon trang trí ngoài tên truy cập và không thay nhãn danh mục", () => {
    render(<div><CategoryIcon name="Ăn uống" kind="expense" /><span>Ăn uống</span></div>);
    expect(screen.getByText("Ăn uống")).toBeTruthy();
    expect(document.querySelector('.category-icon[aria-hidden="true"] svg.lucide-utensils-crossed')).toBeTruthy();
  });
});
