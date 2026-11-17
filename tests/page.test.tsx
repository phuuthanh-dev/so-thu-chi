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
afterEach(() => cleanup());

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
