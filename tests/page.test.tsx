import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const server = vi.hoisted(() => ({ data: {} as Record<string, unknown>, version: 0, offline: false, saveFails: false }));
vi.mock("../src/app/auth", () => ({
  AuthGate: ({ children }: { children: (client: unknown, user: unknown) => React.ReactNode }) => children({
    rpc: async (name: string, args?: { expected_version: number; new_data: Record<string, unknown> }) => {
      if (name === "recurring_status") return { data: [], error: null };
      if (name === "open_ledger") return server.offline ? { data: null, error: { message: "offline" } } : { data: [{ version: server.version, data: structuredClone(server.data) }], error: null };
      if (name === "save_ledger") {
        if (server.saveFails) return { data: null, error: { message: "offline" } };
        if (args?.expected_version !== server.version) return { data: [], error: null };
        server.data = structuredClone(args.new_data); server.version++;
        return { data: [{ version: server.version, data: structuredClone(server.data) }], error: null };
      }
      throw new Error(`unexpected RPC: ${name}`);
    },
    auth: { signOut: async () => ({ error: null }) },
  }, { id: "test-user", phone: "0123456789" }),
}));
import Page from "../src/app/page";

beforeEach(() => {
  localStorage.clear(); server.version = 0; server.offline = false; server.saveFails = false;
  server.data = { entries: [], wallets: [{ id: "cash", name: "Tiền mặt", balance: 0 }], budgets: {}, rules: [], categories: { expense: ["Ăn uống", "Khác"], income: ["Lương"] } };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("mở cài đặt từ avatar và quay về tổng quan từ không gian cá nhân", async () => {
  const user = userEvent.setup(); const { container } = render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", { name: "Mở tài khoản" }));
  expect(screen.getByRole("heading", { name: "Cài đặt & dữ liệu" })).toBeTruthy();
  expect(screen.getByText("Tài khoản của bạn")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Mở tổng quan sổ cá nhân" }));
  expect(screen.getByRole("heading", { name: /Chào bạn/ })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cài đặt tài khoản" }));
  expect(screen.getByRole("heading", { name: "Cài đặt & dữ liệu" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Không gian của tôi" }));
  expect(screen.getByRole("heading", { name: /Chào bạn/ })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Mở menu" }));
  expect(container.querySelector("aside")?.classList.contains("open")).toBe(true);
  await user.click(screen.getByRole("button", { name: /^Cài đặt$/ }));
  expect(container.querySelector("aside")?.classList.contains("open")).toBe(false);
  expect(screen.getByRole("heading", { name: "Cài đặt & dữ liệu" })).toBeTruthy();
  await user.click(screen.getAllByRole("button", { name: "Thêm giao dịch" })[0]);
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("các nút điều hướng chính và biểu mẫu đều mở đúng nội dung", async () => {
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", { name: "Sửa ngân sách" }));
  expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Ngân sách tháng" })).toBeTruthy();
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Đóng" }));
  await user.click(screen.getByRole("button", { name: "Chi tiết" }));
  expect(screen.getByRole("heading", { name: "Báo cáo", level: 1 })).toBeTruthy();
  await user.click(screen.getAllByRole("button", { name: "Giao dịch" })[0]);
  expect(screen.getByRole("heading", { name: "Giao dịch", level: 1 })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Thêm mới" }));
  expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Thêm giao dịch" })).toBeTruthy();
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Đóng" }));
  await user.click(screen.getAllByRole("button", { name: "Ví của tôi" })[0]);
  await user.click(screen.getByRole("button", { name: "Thêm ví" }));
  expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Thêm ví mới" })).toBeTruthy();
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Đóng" }));
  await user.click(screen.getAllByRole("button", { name: "Ngân sách" })[0]);
  expect(screen.getByRole("heading", { name: "Ngân sách", level: 1 })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Định kỳ" }));
  await user.click(screen.getByRole("button", { name: "Tạo giao dịch" }));
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Khoản thu" })).toBeTruthy();
});

it("gợi ý số tiền và chỉ thay đổi giá trị khi người dùng chọn", async () => {
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getAllByRole("button", { name: /Thêm giao dịch/ })[0]);
  const dialog = screen.getByRole("dialog");
  const amount = within(dialog).getByLabelText(/Số tiền/) as HTMLInputElement;
  await user.type(amount, "40");
  expect(amount.value).toBe("40");
  const suggestions = within(dialog).getByRole("group", { name: "Gợi ý số tiền" });
  expect(within(suggestions).getByRole("button", { name: "40.000 ₫" })).toBeTruthy();
  expect(within(suggestions).getByRole("button", { name: "400.000 ₫" })).toBeTruthy();
  expect(within(suggestions).getByRole("button", { name: "4.000.000 ₫" })).toBeTruthy();
  await user.click(within(suggestions).getByRole("button", { name: "400.000 ₫" }));
  expect(amount.value).toBe("400000");
  expect(within(dialog).queryByRole("group", { name: "Gợi ý số tiền" })).toBeNull();
  await user.click(within(dialog).getByRole("button", { name: /Lưu giao dịch/ }));
  await waitFor(() => expect(server.version).toBe(1));
  expect((server.data.entries as { amount: number }[])[0].amount).toBe(400000);
});

it("báo mất đồng bộ khi lần tải nền thất bại rồi hồi phục khi kết nối trở lại", async () => {
  render(<Page />);
  await screen.findByText("Đã đồng bộ");
  server.offline = true; fireEvent.focus(window);
  await screen.findByText("Chưa đồng bộ");
  server.offline = false; fireEvent.focus(window);
  await screen.findByText("Đã đồng bộ");
});

it("giữ bản nháp khi lưu lỗi, khôi phục sau khi tải lại và lưu lại được", async () => {
  server.saveFails = true;
  const user = userEvent.setup(); const first = render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getAllByRole("button", { name: /Thêm giao dịch/ })[0]);
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText(/Số tiền/), "12345");
  await user.click(within(dialog).getByRole("button", { name: /Lưu giao dịch/ }));
  await screen.findByText("Chưa lưu");
  expect(localStorage.length).toBe(1);
  first.unmount(); server.saveFails = false; render(<Page />);
  await screen.findByRole("button", { name: "Khôi phục" });
  await user.click(screen.getByRole("button", { name: "Khôi phục" }));
  await user.click(screen.getByRole("button", { name: "Thử lưu lại" }));
  await waitFor(() => expect(localStorage.length).toBe(0));
  expect((server.data.entries as { amount: number }[])[0].amount).toBe(12345);
});

it("sửa quy tắc định kỳ mà không thay đổi giao dịch cũ hoặc ngày neo", async () => {
  server.data.rules = [{ id: "rule", type: "expense", amount: 100, category: "Ăn uống", note: "Tiền nhà", wallet: "cash", next: "2027-02-28", anchorDay: 31, active: true }];
  server.data.entries = [{ id: "old", type: "expense", amount: 100, category: "Ăn uống", note: "Tiền nhà", wallet: "cash", date: "2026-11-01", origin: "rule:2026-11-01" }];
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getAllByRole("button", { name: "Định kỳ" })[0]);
  await user.click(screen.getByRole("button", { name: "Sửa" }));
  const dialog = screen.getByRole("dialog");
  await user.clear(within(dialog).getByLabelText(/Số tiền/));
  await user.type(within(dialog).getByLabelText(/Số tiền/), "200");
  await user.click(within(dialog).getByRole("button", { name: /Lưu thay đổi/ }));
  await waitFor(() => expect(server.version).toBe(1));
  expect((server.data.rules as { amount: number; anchorDay: number }[])[0]).toMatchObject({ amount: 200, anchorDay: 31 });
  expect((server.data.entries as { amount: number }[])[0].amount).toBe(100);
});

it("sửa tên và số dư ban đầu của ví, giữ nguyên giao dịch", async () => {
  server.data.entries = [{ id: "old", type: "expense", amount: 100, category: "Ăn uống", note: "", wallet: "cash", date: "2026-11-01" }];
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getAllByRole("button", { name: "Ví của tôi" })[0]);
  await user.click(screen.getByRole("button", { name: "Sửa ví Tiền mặt" }));
  const dialog = screen.getByRole("dialog");
  await user.clear(within(dialog).getByLabelText("Tên ví"));
  await user.type(within(dialog).getByLabelText("Tên ví"), "Ví gia đình");
  await user.clear(within(dialog).getByLabelText(/Số dư ban đầu/));
  await user.type(within(dialog).getByLabelText(/Số dư ban đầu/), "1000");
  await user.click(within(dialog).getByRole("button", { name: "Lưu thay đổi" }));
  await waitFor(() => expect(server.version).toBe(1));
  expect((server.data.wallets as { name: string; balance: number }[])[0]).toMatchObject({ name: "Ví gia đình", balance: 1000 });
  expect((server.data.entries as { amount: number }[])[0].amount).toBe(100);
  expect(screen.getByText("900 ₫")).toBeTruthy();
});

it("lưu trữ ví đã dùng và khôi phục mà không xóa lịch sử", async () => {
  (server.data.wallets as unknown[]).push({ id: "bank", name: "Ngân hàng", balance: 500 });
  server.data.entries = [{ id: "old", type: "expense", amount: 100, category: "Ăn uống", note: "", wallet: "bank", date: "2026-11-01" }];
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getAllByRole("button", { name: "Ví của tôi" })[0]);
  await user.click(screen.getByRole("button", { name: "Xóa ví Ngân hàng" }));
  await screen.findByRole("button", { name: "Khôi phục ví Ngân hàng" });
  expect((server.data.entries as { wallet: string }[])[0].wallet).toBe("bank");
  expect((server.data.wallets as { id: string; archived?: boolean }[]).find((w) => w.id === "bank")?.archived).toBe(true);
  await user.click(screen.getByRole("button", { name: "Khôi phục ví Ngân hàng" }));
  await screen.findByRole("button", { name: "Sửa ví Ngân hàng" });
  await waitFor(() => expect(server.version).toBe(2));
  expect((server.data.wallets as { id: string; archived?: boolean }[]).find((w) => w.id === "bank")?.archived).toBe(false);
});

it("chỉ xóa ví chưa sử dụng sau xác nhận; giữ ví cuối và ví có quy tắc", async () => {
  (server.data.wallets as unknown[]).push({ id: "bank", name: "Ngân hàng", balance: 0 });
  server.data.rules = [{ id: "rule", wallet: "bank", type: "expense", amount: 100, category: "Ăn uống", note: "", next: "2027-01-01", active: false }];
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getAllByRole("button", { name: "Ví của tôi" })[0]);
  await user.click(screen.getByRole("button", { name: "Xóa ví Ngân hàng" }));
  expect(alert).toHaveBeenCalledWith(expect.stringContaining("giao dịch định kỳ"));
  await user.click(screen.getByRole("button", { name: "Xóa ví Tiền mặt" }));
  await waitFor(() => expect(server.version).toBe(1));
  expect(confirm).toHaveBeenCalledOnce();
  expect((server.data.wallets as unknown[])).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Xóa ví Ngân hàng" }));
  expect(alert).toHaveBeenLastCalledWith(expect.stringContaining("ít nhất một ví"));
});
