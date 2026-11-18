import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildReport, formatReportShare, shiftReportMonth, type ReportEntry } from "../src/lib/report";
import { Report } from "../src/app/report";

afterEach(cleanup);
const entries: ReportEntry[] = [
  { date: "2026-01-02", type: "income", amount: 1000, category: "Lương" },
  { date: "2026-01-03", type: "income", amount: 300, category: "Thưởng" },
  { date: "2026-01-05", type: "expense", amount: 400, category: "Ăn uống" },
  { date: "2026-01-08", type: "expense", amount: 200, category: "Ăn uống" },
  { date: "2026-01-08", type: "expense", amount: 100, category: "Đi lại" },
  { date: "2025-12-30", type: "income", amount: 900, category: "Lương" },
  { date: "2025-12-31", type: "expense", amount: 800, category: "Đi lại" },
  { date: "2026-02-01", type: "expense", amount: 5000, category: "Khác" },
];

describe("báo cáo theo tháng", () => {
  it("không làm tròn tỷ trọng có giá trị thành 0% hoặc 100%", () => {
    expect(formatReportShare(1, 1000000)).toBe("<0,1%");
    expect(formatReportShare(999999, 1000000)).toBe(">99,9%");
    expect(formatReportShare(1, 3)).toBe("33,3%");
    expect(formatReportShare(2, 3)).toBe("66,7%");
    expect(formatReportShare(0, 0)).toBe("0%");
    expect(formatReportShare(100, 100)).toBe("100%");
  });
  it("tổng hợp thu chi và xếp hạng danh mục, đúng qua ranh giới năm", () => {
    const report = buildReport(entries, "2026-01");
    expect(shiftReportMonth("2026-01", -1)).toBe("2025-12");
    expect(report.months.map((item) => item.month)).toEqual(["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]);
    expect(report.current).toMatchObject({ income: 1300, expense: 700, incomeCount: 2, expenseCount: 3 });
    expect(report.previous).toMatchObject({ income: 900, expense: 800 });
    expect(report.categories.expense).toEqual([{ name: "Ăn uống", amount: 600, count: 2 }, { name: "Đi lại", amount: 100, count: 1 }]);
    expect(report.categories.income.map((item) => item.name)).toEqual(["Lương", "Thưởng"]);
  });
  it("thể hiện tháng trống và không nhập giao dịch ngoài kỳ", () => {
    const report = buildReport(entries, "2026-03");
    expect(report.current).toMatchObject({ income: 0, expense: 0, incomeCount: 0, expenseCount: 0 });
    expect(report.categories).toEqual({ income: [], expense: [] });
    expect(report.previous.expense).toBe(5000);
  });
  it("dùng cùng thang đo biểu đồ và hiển thị tỷ trọng rất nhỏ", () => {
    const edgeEntries: ReportEntry[] = [
      { date: "2026-01-01", type: "income", amount: 1000, category: "Lương" },
      { date: "2025-12-01", type: "income", amount: 500, category: "Lương" },
      { date: "2026-01-02", type: "expense", amount: 1, category: "Khoản nhỏ" },
      { date: "2026-01-02", type: "expense", amount: 999999, category: "Khoản lớn" },
    ];
    const { container } = render(<Report entries={edgeEntries} month="2026-01" onSelectMonth={() => {}} />);
    expect(screen.getByText(/<0,1%/)).toBeTruthy();
    expect(screen.getByText(/>99,9%/)).toBeTruthy();
    const rows = container.querySelectorAll(".report-trend-row");
    expect((rows[4].querySelector(".report-bar-income") as HTMLElement).style.width).toBe("0.05%");
    expect((rows[5].querySelector(".report-bar-expense") as HTMLElement).style.width).toBe("100%");
  });
  it("hiển thị so sánh, chuyển danh mục và chọn tháng", async () => {
    const selectMonth = vi.fn();
    const user = userEvent.setup();
    render(<Report entries={entries} month="2026-01" onSelectMonth={selectMonth} />);
    expect(screen.getByText(/Tăng 400\s₫ so với tháng trước/)).toBeTruthy();
    expect(screen.getByText(/Giảm 100\s₫ so với tháng trước/)).toBeTruthy();
    const categorySection = screen.getByRole("heading", { name: "Phân tích danh mục" }).closest("section")!;
    expect(within(categorySection).getByText("Ăn uống")).toBeTruthy();
    await user.click(within(categorySection).getByRole("button", { name: "Thu nhập" }));
    expect(within(categorySection).getByText("Thưởng")).toBeTruthy();
    expect(within(categorySection).queryByText("Ăn uống")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Tháng 12/2025" }));
    expect(selectMonth).toHaveBeenCalledWith("2025-12");
  });
  it("không tạo phần trăm sai khi tháng trước không có dữ liệu", () => {
    render(<Report entries={[]} month="2026-01" onSelectMonth={() => {}} />);
    expect(screen.getByText("Tháng trước chưa có khoản thu")).toBeTruthy();
    expect(screen.getByText("Tháng trước chưa có khoản chi")).toBeTruthy();
    expect(screen.getByText("Chưa có khoản chi trong tháng này.")).toBeTruthy();
  });
});
