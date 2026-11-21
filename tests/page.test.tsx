import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { prepareAvatar } from "../src/lib/avatar";

type AppearanceFixture = {kind: string; category: string; icon_key: string | null; color_key: string | null; revision: number};
const server = vi.hoisted(() => ({ data: {} as Record<string, unknown>, appearances: [] as AppearanceFixture[], version: 0, offline: false, saveFails: false }));
vi.mock("../src/lib/avatar", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/lib/avatar")>()), prepareAvatar: vi.fn() }));
vi.mock("../src/app/secure-avatar", () => ({
  uploadAvatar: vi.fn(async (_client: unknown, image: string) => `cloudinary:test/${image.endsWith("YQ==") ? "first" : "second"}`),
  SecureAvatar: ({avatar,fallback}:{avatar?:string|null;fallback:string}) => avatar ? React.createElement("img",{src:avatar,alt:""}) : fallback,
}));
vi.mock("../src/app/avatar-editor", () => ({ AvatarEditor: ({ onSave, onCancel, error }: { onSave: (crop: { zoom: number; x: number; y: number }) => void; onCancel: () => void; error: string }) => <div>{error && <p role="alert">{error}</p>}<button onClick={() => onSave({ zoom: 2, x: 25, y: 75 })}>Lưu ảnh</button><button onClick={onCancel}>Hủy</button></div> }));
vi.mock("../src/app/auth", () => ({
  AuthGate: ({ children }: { children: (client: unknown, user: unknown) => React.ReactNode }) => children({
    rpc: async (name: string, args?: { expected_version: string; new_data: Record<string, unknown>; p_expected_version: string; p_new_data: Record<string, unknown>; p_kind: string; p_category: string; p_new_name: string; p_icon: string | null; p_color: string | null; p_expected_revision: number; p_expected_new_revision: number; p_display_name: string }) => {
      if (name === "category_appearances_get") return server.offline ? {data:null,error:{message:"offline"}} : {data:structuredClone(server.appearances),error:null};
      if (name === "category_appearance_update" || name === "category_rename_with_appearance") {
        if (!args || server.saveFails) return {data:null,error:{message:"offline"}};
        const category = name === "category_appearance_update" ? args.p_category : args.p_new_name;
        const expected = name === "category_appearance_update" ? args.p_expected_revision : args.p_expected_new_revision;
        const prior = server.appearances.find(item => item.kind === args.p_kind && item.category === category);
        if ((prior?.revision || 0) !== expected) return {data:null,error:{code:"40001"}};
        if (name === "category_rename_with_appearance") {
          if (args.p_expected_version !== `${server.version}:none:0`) return {data:[],error:null};
          server.data=structuredClone(args.p_new_data); server.version++;
        }
        const row={kind:args.p_kind,category,icon_key:args.p_icon,color_key:args.p_color,revision:expected+1};
        server.appearances=[...server.appearances.filter(item => item.kind !== row.kind || item.category !== row.category),row];
        return {data:name === "category_appearance_update" ? [row] : [{version:`${server.version}:none:0`,data:structuredClone(server.data)}],error:null};
      }
      if (name === "open_ledger") return {data:[{version:server.version,data:structuredClone(server.data)}],error:null};
      if (name === "account_set_display_name") {
        if (Number(args?.p_expected_version) !== server.version) return {data:[],error:null};
        server.data.displayName = args?.p_display_name; server.version++;
        return {data:[{version:server.version,display_name:server.data.displayName}],error:null};
      }
      if (name === "wallet_transfer_state") return {data:{wallets:(server.data.wallets as {id:string; name:string}[]).map(w => ({ref:`p:${w.id}`,walletId:w.id,name:w.name,ownerId:"test-user"})),legs:[]},error:null};
      if (name === "family_status") return { data: null, error: null };
      if (name === "family_recurring_status") return { data: null, error: { code: "42501" } };
      if (name === "recurring_status") return { data: [], error: null };
      if (name === "personal_combined_open") return server.offline ? { data: null, error: { message: "offline" } } : { data: [{ version: `${server.version}:none:0`, data: structuredClone(server.data) }], error: null };
      if (name === "personal_combined_save") {
        if (server.saveFails) return { data: null, error: { message: "offline" } };
        if (args?.expected_version !== `${server.version}:none:0`) return { data: [], error: null };
        server.data = structuredClone(args.new_data); server.version++;
        return { data: [{ version: `${server.version}:none:0`, data: structuredClone(server.data) }], error: null };
      }
      throw new Error(`unexpected RPC: ${name}`);
    },
    auth: { signOut: async () => ({ error: null }) },
  }, { id: "test-user", phone: "0123456789" }),
}));
import Page from "../src/app/page";

beforeEach(() => {
  vi.mocked(prepareAvatar).mockReset();
  localStorage.clear(); server.appearances = []; server.version = 0; server.offline = false; server.saveFails = false;
  server.data = { entries: [], wallets: [{ id: "cash", name: "Tiền mặt", balance: 0 }], budgets: {}, rules: [], categories: { expense: ["Ăn uống", "Khác"], income: ["Lương"] } };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("mở trang phân tích riêng từ báo cáo mà không ghi dữ liệu", async () => {
  const user = userEvent.setup();
  render(<Page />);
  await screen.findByText("Đã đồng bộ");
  expect(screen.getByRole("heading", { name: "Giao dịch gần đây" })).toBeTruthy();
  await user.click(screen.getAllByRole("button", { name: "Báo cáo" })[0]);
  expect(screen.getByRole("heading", { name: "Xu hướng 6 tháng" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Phân tích danh mục" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Giao dịch gần đây" })).toBeNull();
  const firstMonth = within(screen.getByRole("region", { name: "Xu hướng 6 tháng" })).getAllByRole("button")[0];
  const firstMonthLabel = firstMonth.getAttribute("aria-label")!;
  await user.click(firstMonth);
  expect(screen.getByRole("button", { name: firstMonthLabel }).getAttribute("aria-pressed")).toBe("true");
  expect(server.version).toBe(0);
});

it("lưu, thay và xóa ảnh đại diện theo tài khoản mà giữ giao dịch", async () => {
  server.data.entries = [{ id: "old", type: "expense", amount: 100, category: "Ăn uống", note: "", wallet: "cash", date: "2026-11-01" }];
  vi.mocked(prepareAvatar).mockResolvedValueOnce("data:image/webp;base64,YQ==").mockResolvedValueOnce("data:image/webp;base64,Yg==");
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", { name: "Mở tài khoản" }));
  await user.upload(screen.getByLabelText("Chọn ảnh"), new File(["a"], "avatar.png", { type: "image/png" }));
  expect(server.version).toBe(0);
  await user.click(screen.getByRole("button", { name: "Lưu ảnh" }));
  await waitFor(() => expect(server.data.avatar).toBe("cloudinary:test/first"));
  expect(prepareAvatar).toHaveBeenCalledWith(expect.any(File), { zoom: 2, x: 25, y: 75 });
  await user.upload(screen.getByLabelText("Đổi ảnh"), new File(["b"], "avatar2.png", { type: "image/png" }));
  await user.click(screen.getByRole("button", { name: "Lưu ảnh" }));
  await waitFor(() => expect(server.data.avatar).toBe("cloudinary:test/second"));
  expect((server.data.entries as { amount: number }[])[0].amount).toBe(100);
  await user.click(screen.getByRole("button", { name: "Xóa ảnh" }));
  await waitFor(() => expect(server.data.avatar).toBeNull());
  expect(screen.getByLabelText("Chọn ảnh")).toBeTruthy();
});

it("hiển thị lỗi xử lý ảnh và không thay đổi dữ liệu", async () => {
  vi.mocked(prepareAvatar).mockRejectedValueOnce(new Error("Ảnh cần nhỏ hơn 5 MB."));
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", { name: "Mở tài khoản" }));
  await user.upload(screen.getByLabelText("Chọn ảnh"), new File(["a"], "avatar.png", { type: "image/png" }));
  await user.click(screen.getByRole("button", { name: "Lưu ảnh" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Ảnh cần nhỏ hơn 5 MB.");
  expect(server.version).toBe(0);
});

it("ảnh đại diện đồng bộ sang một phiên khác khi làm mới", async () => {
  vi.mocked(prepareAvatar).mockResolvedValueOnce("data:image/webp;base64,YQ==");
  const user = userEvent.setup();
  const first = render(<Page />); const second = render(<Page />);
  await within(first.container).findByText("Đã đồng bộ");
  await within(second.container).findByText("Đã đồng bộ");
  await user.click(within(first.container).getByRole("button", { name: "Mở tài khoản" }));
  await user.upload(within(first.container).getByLabelText("Chọn ảnh"), new File(["a"], "avatar.png", { type: "image/png" }));
  await user.click(within(first.container).getByRole("button", { name: "Lưu ảnh" }));
  await waitFor(() => expect(server.data.avatar).toBe("cloudinary:test/first"));
  fireEvent.focus(window);
  await waitFor(() => expect(within(second.container).getByRole("button", { name: "Mở tài khoản" }).querySelector("img")?.getAttribute("src")).toBe("cloudinary:test/first"));
});

it("không lưu ảnh nếu tài khoản đã đóng trong lúc xử lý", async () => {
  let finish!: (image: string) => void;
  vi.mocked(prepareAvatar).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const user = userEvent.setup(); const view = render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", { name: "Mở tài khoản" }));
  await user.upload(screen.getByLabelText("Chọn ảnh"), new File(["a"], "avatar.png", { type: "image/png" }));
  await user.click(screen.getByRole("button", { name: "Lưu ảnh" }));
  view.unmount(); finish("data:image/webp;base64,YQ==");
  await Promise.resolve(); await Promise.resolve();
  expect(server.version).toBe(0);
});

it("cho phép tắt hiệu ứng hoa trên thiết bị", async () => {
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", { name: "Mở tài khoản" }));
  await user.click(screen.getByRole("button", { name: "Tắt hiệu ứng" }));
  expect(localStorage.getItem("nha-minh-motion")).toBe("off");
  expect(screen.getByRole("button", { name: "Bật hiệu ứng" }).getAttribute("aria-pressed")).toBe("false");
});

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
  await user.click(screen.getByRole("button", { name: "Đóng thanh bên" }));
  expect(container.querySelector("aside")?.classList.contains("open")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Mở menu" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(container.querySelector("aside")?.classList.contains("open")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Mở menu" }));
  await user.click(screen.getByRole("button", { name: /^Cài đặt$/ }));
  expect(container.querySelector("aside")?.classList.contains("open")).toBe(false);
  expect(screen.getByRole("heading", { name: "Cài đặt & dữ liệu" })).toBeTruthy();
  await user.click(screen.getAllByRole("button", { name: "Thêm giao dịch" })[0]);
  expect(screen.getByRole("dialog")).toBeTruthy();
}, 15000);

it("hủy điều chỉnh ảnh không ghi đè ảnh đã lưu", async () => {
  server.data.avatar = "data:image/webp;base64,YQ==";
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", { name: "Mở tài khoản" }));
  await user.upload(screen.getByLabelText("Đổi ảnh"), new File(["b"], "new.png", { type: "image/png" }));
  await user.click(screen.getByRole("button", { name: "Hủy" }));
  expect(server.data.avatar).toBe("data:image/webp;base64,YQ==");
  expect(server.version).toBe(0);
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
}, 15000);

it("gợi ý số tiền và chỉ thay đổi giá trị khi người dùng chọn", async () => {
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getAllByRole("button", { name: /Thêm giao dịch/ })[0]);
  const dialog = screen.getByRole("dialog");
  const amount = within(dialog).getByLabelText(/Số tiền/) as HTMLInputElement;
  await user.type(amount, "40");
  expect(amount.value).toBe("40");
  const suggestions = within(dialog).getByRole("group", { name: "Gợi ý số tiền" });
  expect(within(suggestions).getByRole("button", { name: /^40\.000\s₫$/ })).toBeTruthy();
  expect(within(suggestions).getByRole("button", { name: /^400\.000\s₫$/ })).toBeTruthy();
  expect(within(suggestions).getByRole("button", { name: /^4\.000\.000\s₫$/ })).toBeTruthy();
  await user.click(within(suggestions).getByRole("button", { name: /^400\.000\s₫$/ }));
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

it("xóa danh mục đã dùng nhưng giữ lịch sử và quy tắc định kỳ có thể chỉnh sửa", async () => {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  server.data.entries = [{ id: "old", type: "expense", amount: 100, category: "Ăn uống", note: "Bữa sáng", wallet: "cash", date }];
  server.data.rules = [{ id: "rule", type: "expense", amount: 200, category: "Ăn uống", note: "Bữa tối", wallet: "cash", next: date, active: true }];
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", { name: "Mở tài khoản" }));
  await user.click(screen.getByRole("button", { name: "Quản lý danh mục" }));
  let dialog = within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("button", { name: "Xóa danh mục Ăn uống" }));
  expect(server.version).toBe(0);
  expect(dialog.getByText("Ăn uống")).toBeTruthy();
  await user.click(dialog.getByRole("button", { name: "Xóa danh mục Ăn uống" }));
  expect(confirm.mock.calls[1][0]).toContain("Giao dịch định kỳ");
  await waitFor(() => expect((server.data.categories as {expense:string[]}).expense).toEqual(["Khác"]));
  expect((server.data.entries as {category:string}[])[0].category).toBe("Ăn uống");
  expect((server.data.rules as {category:string}[])[0].category).toBe("Ăn uống");
  await user.click(dialog.getByRole("button", { name: "Đóng" }));
  await user.click(screen.getAllByRole("button", { name: "Giao dịch" })[0]);
  await user.click(screen.getByRole("button", { name: /Bữa sáng/ }));
  dialog = within(screen.getByRole("dialog"));
  expect((dialog.getByLabelText("Danh mục *") as HTMLSelectElement).value).toBe("Ăn uống");
  expect(dialog.getByRole("option", { name: "Ăn uống (đã xóa)" })).toBeTruthy();
  await user.click(dialog.getByRole("button", { name: "Lưu thay đổi" }));
  await waitFor(() => expect(server.version).toBe(2));
  expect((server.data.entries as {category:string}[])[0].category).toBe("Ăn uống");
  await user.click(screen.getByRole("button", { name: "Định kỳ" }));
  await user.click(screen.getByRole("button", { name: "Sửa" }));
  dialog = within(screen.getByRole("dialog"));
  expect((dialog.getByLabelText("Danh mục *") as HTMLSelectElement).value).toBe("Ăn uống");
  expect(dialog.getByRole("option", { name: "Ăn uống (đã xóa)" })).toBeTruthy();
  await user.click(dialog.getByRole("button", { name: "Lưu thay đổi" }));
  await waitFor(() => expect(server.version).toBe(3));
  expect((server.data.rules as {category:string}[])[0].category).toBe("Ăn uống");
  await user.click(screen.getByRole("button", { name: "Thêm giao dịch" }));
  dialog = within(screen.getByRole("dialog"));
  expect(dialog.queryByRole("option", { name: /Ăn uống/ })).toBeNull();
}, 20000);

it("cho phép xóa danh mục cuối cùng của cả thu và chi, rồi thêm lại", async () => {
  server.data.categories = { expense: ["Ăn uống"], income: ["Lương"] };
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", { name: "Mở tài khoản" }));
  await user.click(screen.getByRole("button", { name: "Quản lý danh mục" }));
  let dialog = within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("button", { name: "Xóa danh mục Ăn uống" }));
  await waitFor(() => expect(server.version).toBe(1));
  expect(dialog.getByText("Chưa có danh mục nào.")).toBeTruthy();
  await user.click(dialog.getByRole("button", { name: "Thu nhập" }));
  await user.click(dialog.getByRole("button", { name: "Xóa danh mục Lương" }));
  await waitFor(() => expect(server.version).toBe(2));
  expect((server.data.categories as {income:string[]}).income).toEqual([]);
  await user.click(dialog.getByRole("button", { name: "Đóng" }));
  await user.click(screen.getByRole("button", { name: "Thêm giao dịch" }));
  dialog = within(screen.getByRole("dialog"));
  expect((dialog.getByLabelText("Danh mục *") as HTMLSelectElement).value).toBe("");
  expect(dialog.getByText(/Chưa có danh mục\. Vào Cài đặt/)).toBeTruthy();
  await user.type(dialog.getByLabelText(/Số tiền/), "100");
  await user.click(dialog.getByRole("button", { name: "Lưu giao dịch" }));
  expect(server.version).toBe(2);
  await user.click(dialog.getByRole("button", { name: "Đóng" }));
  await user.click(screen.getByRole("button", { name: "Quản lý danh mục" }));
  dialog = within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("button", { name: "Chi tiêu" }));
  await user.type(dialog.getByLabelText("Tên danh mục mới"), "Ăn uống");
  await user.click(dialog.getByRole("button", { name: "Thêm danh mục" }));
  await waitFor(() => expect((server.data.categories as {expense:string[]}).expense).toEqual(["Ăn uống"]));
}, 20000);

it("đồng bộ việc xóa danh mục sang phiên khác khi làm mới", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  const first = render(<Page />); const second = render(<Page />);
  await within(first.container).findByText("Đã đồng bộ");
  await within(second.container).findByText("Đã đồng bộ");
  await user.click(within(first.container).getByRole("button", { name: "Mở tài khoản" }));
  await user.click(within(first.container).getByRole("button", { name: "Quản lý danh mục" }));
  await user.click(within(first.container).getByRole("button", { name: "Xóa danh mục Ăn uống" }));
  await waitFor(() => expect(server.version).toBe(1));
  fireEvent.focus(window);
  await waitFor(() => expect(within(second.container).getByText("Đã đồng bộ")).toBeTruthy());
  await user.click(within(second.container).getByRole("button", { name: "Mở tài khoản" }));
  await user.click(within(second.container).getByRole("button", { name: "Quản lý danh mục" }));
  await waitFor(() => expect(within(second.container).queryByRole("button", { name: "Xóa danh mục Ăn uống" })).toBeNull());
  expect(within(second.container).getByRole("button", { name: "Xóa danh mục Khác" })).toBeTruthy();
}, 20000);

it("đổi tên danh mục chi đồng bộ lịch sử và định kỳ nhưng không đổi khoản thu cùng tên", async () => {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  server.data.categories = { expense: ["Ăn uống", "Khác"], income: ["Ăn uống"] };
  server.data.entries = [
    { id: "e1", type: "expense", amount: 1200, category: "Ăn uống", note: "Bữa ăn", wallet: "cash", date, origin: "r1:2026-01-01" },
    { id: "e2", type: "income", amount: 300, category: "Ăn uống", note: "Thu", wallet: "cash", date },
  ];
  server.data.rules = [
    { id: "r1", type: "expense", amount: 1200, category: "Ăn uống", note: "Bữa ăn", wallet: "cash", next: date, active: false, anchorDay: 15 },
    { id: "r2", type: "income", amount: 300, category: "Ăn uống", note: "Thu", wallet: "cash", next: date, active: true },
  ];
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", { name: "Mở tài khoản" }));
  await user.click(screen.getByRole("button", { name: "Quản lý danh mục" }));
  let dialog = within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("button", { name: "Sửa danh mục Ăn uống" }));
  const name = dialog.getByLabelText("Đổi tên “Ăn uống”");
  expect(document.activeElement).toBe(name);
  await user.clear(name); await user.type(name, "Ăn uống gia đình");
  await user.click(dialog.getByRole("button", { name: "Lưu thay đổi" }));
  await waitFor(() => expect(server.version).toBe(1));
  expect((server.data.categories as {expense:string[];income:string[]}).expense).toEqual(["Ăn uống gia đình", "Khác"]);
  expect((server.data.categories as {expense:string[];income:string[]}).income).toEqual(["Ăn uống"]);
  expect(server.data.entries).toEqual([
    expect.objectContaining({ id: "e1", type: "expense", category: "Ăn uống gia đình", amount: 1200, origin: "r1:2026-01-01" }),
    expect.objectContaining({ id: "e2", type: "income", category: "Ăn uống", amount: 300 }),
  ]);
  expect(server.data.rules).toEqual([
    expect.objectContaining({ id: "r1", category: "Ăn uống gia đình", active: false, anchorDay: 15 }),
    expect.objectContaining({ id: "r2", category: "Ăn uống", active: true }),
  ]);
  dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("button", { name: "Sửa danh mục Ăn uống gia đình" })).toBeTruthy();
  await user.click(dialog.getByRole("button", { name: "Đóng" }));
  await user.click(screen.getAllByRole("button", { name: "Báo cáo" })[0]);
  expect(screen.getByText("Ăn uống gia đình")).toBeTruthy();
}, 20000);

it("từ chối tên trống hoặc trùng, cho phép hủy và đổi tên danh mục thu", async () => {
  server.data.categories = { expense: ["Ăn uống", "Khác"], income: ["Lương", "Thưởng"] };
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", { name: "Mở tài khoản" }));
  await user.click(screen.getByRole("button", { name: "Quản lý danh mục" }));
  const dialog = within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("button", { name: "Sửa danh mục Ăn uống" }));
  let name = dialog.getByLabelText("Đổi tên “Ăn uống”");
  await user.clear(name); await user.click(dialog.getByRole("button", { name: "Lưu thay đổi" }));
  expect(dialog.getByRole("alert").textContent).toContain("Vui lòng nhập tên");
  await user.type(name, "KHÁC"); await user.click(dialog.getByRole("button", { name: "Lưu thay đổi" }));
  expect(dialog.getByRole("alert").textContent).toContain("đã tồn tại");
  expect(server.version).toBe(0);
  await user.click(dialog.getByRole("button", { name: "Hủy" }));
  expect(dialog.getByRole("button", { name: "Sửa danh mục Ăn uống" })).toBeTruthy();
  await user.click(dialog.getByRole("button", { name: "Thu nhập" }));
  await user.click(dialog.getByRole("button", { name: "Sửa danh mục Lương" }));
  name = dialog.getByLabelText("Đổi tên “Lương”");
  await user.clear(name); await user.type(name, "Lương chính{Enter}");
  await waitFor(() => expect(server.version).toBe(1));
  expect((server.data.categories as {income:string[]}).income).toEqual(["Lương chính", "Thưởng"]);
}, 20000);

it("cảnh báo trước khi gộp danh mục đã xóa còn trong lịch sử", async () => {
  server.data.entries = [{ id: "old", type: "expense", amount: 250, category: "Du lịch cũ", note: "", wallet: "cash", date: "2026-01-01" }];
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", { name: "Mở tài khoản" }));
  await user.click(screen.getByRole("button", { name: "Quản lý danh mục" }));
  const dialog = within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("button", { name: "Sửa danh mục Ăn uống" }));
  const name = dialog.getByLabelText("Đổi tên “Ăn uống”");
  await user.clear(name); await user.type(name, "Du lịch cũ");
  await user.click(dialog.getByRole("button", { name: "Lưu thay đổi" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(confirm.mock.calls[0][0]).toContain("gộp");
  expect(server.version).toBe(0);
  await user.click(dialog.getByRole("button", { name: "Lưu thay đổi" }));
  await waitFor(() => expect(server.version).toBe(1));
  expect((server.data.entries as {category:string}[])[0].category).toBe("Du lịch cũ");
  expect((server.data.categories as {expense:string[]}).expense).toEqual(["Du lịch cũ", "Khác"]);
}, 20000);

it("đồng bộ tên danh mục đã sửa sang phiên khác", async () => {
  const user = userEvent.setup();
  const first = render(<Page />); const second = render(<Page />);
  await within(first.container).findByText("Đã đồng bộ");
  await within(second.container).findByText("Đã đồng bộ");
  await user.click(within(first.container).getByRole("button", { name: "Mở tài khoản" }));
  await user.click(within(first.container).getByRole("button", { name: "Quản lý danh mục" }));
  await user.click(within(first.container).getByRole("button", { name: "Sửa danh mục Ăn uống" }));
  const name = within(first.container).getByLabelText("Đổi tên “Ăn uống”");
  await user.clear(name); await user.type(name, "Ăn uống mới");
  await user.click(within(first.container).getByRole("button", { name: "Lưu thay đổi" }));
  await waitFor(() => expect(server.version).toBe(1));
  fireEvent.focus(window);
  await user.click(within(second.container).getByRole("button", { name: "Mở tài khoản" }));
  await user.click(within(second.container).getByRole("button", { name: "Quản lý danh mục" }));
  await waitFor(() => expect(within(second.container).getByRole("button", { name: "Sửa danh mục Ăn uống mới" })).toBeTruthy());
  expect(within(second.container).queryByRole("button", { name: "Sửa danh mục Ăn uống" })).toBeNull();
}, 20000);

it("chọn icon màu riêng, đồng bộ sang phiên khác và khôi phục tự động", async () => {
  const user = userEvent.setup();
  const first = render(<Page />); const second = render(<Page />);
  await within(first.container).findByText("Đã đồng bộ");
  await within(second.container).findByText("Đã đồng bộ");
  await user.click(within(first.container).getByRole("button", {name:"Mở tài khoản"}));
  await user.click(within(first.container).getByRole("button", {name:"Quản lý danh mục"}));
  const dialog = within(first.container).getByRole("dialog");
  await user.click(within(dialog).getByRole("button", {name:"Sửa danh mục Ăn uống"}));
  await user.click(within(dialog).getByRole("button", {name:"Icon Quà tặng"}));
  await user.click(within(dialog).getByRole("button", {name:"Màu Xanh dương"}));
  await user.click(within(dialog).getByRole("button", {name:"Lưu thay đổi"}));
  await waitFor(() => expect(server.appearances).toEqual([expect.objectContaining({kind:"expense",category:"Ăn uống",icon_key:"gift",color_key:"blue"})]));
  fireEvent.focus(window);
  await user.click(within(second.container).getByRole("button", {name:"Mở tài khoản"}));
  await user.click(within(second.container).getByRole("button", {name:"Quản lý danh mục"}));
  const secondDialog = within(second.container).getByRole("dialog");
  await waitFor(() => expect(secondDialog.querySelector(".category-chip svg.lucide-gift")).toBeTruthy());
  await user.click(within(secondDialog).getByRole("button", {name:"Sửa danh mục Ăn uống"}));
  expect(within(secondDialog).getByRole("button",{name:"Icon Quà tặng"}).getAttribute("aria-pressed")).toBe("true");
  await user.click(within(secondDialog).getByRole("button",{name:"Icon tự động"}));
  await user.click(within(secondDialog).getByRole("button",{name:"Màu tự động"}));
  await user.click(within(secondDialog).getByRole("button",{name:"Lưu thay đổi"}));
  await waitFor(() => expect(server.appearances[0]).toEqual(expect.objectContaining({icon_key:null,color_key:null,revision:2})));
}, 20000);

it("giữ lựa chọn khi đổi tên và không ghi khi gặp xung đột", async () => {
  server.appearances=[{kind:"expense",category:"Ăn uống",icon_key:"food",color_key:"orange",revision:1}];
  const user=userEvent.setup(); render(<Page />); await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button",{name:"Mở tài khoản"}));
  await user.click(screen.getByRole("button",{name:"Quản lý danh mục"}));
  const dialog=within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("button",{name:"Sửa danh mục Ăn uống"}));
  const name=dialog.getByLabelText("Đổi tên “Ăn uống”"); await user.clear(name); await user.type(name,"Ăn uống mới");
  await user.click(dialog.getByRole("button",{name:"Lưu thay đổi"}));
  await waitFor(()=>expect(server.appearances.some(item=>item.category==="Ăn uống mới" && item.icon_key==="food" && item.color_key==="orange")).toBe(true));
  await user.click(dialog.getByRole("button",{name:"Sửa danh mục Ăn uống mới"}));
  server.appearances=server.appearances.map(item=>item.category==="Ăn uống mới"?{...item,revision:item.revision+1}:item);
  await user.click(dialog.getByRole("button",{name:"Màu Đỏ"}));
  await user.click(dialog.getByRole("button",{name:"Lưu thay đổi"}));
  expect((await dialog.findByRole("alert")).textContent).toContain("thiết bị khác");
  expect(server.appearances.find(item=>item.category==="Ăn uống mới")?.color_key).toBe("orange");
}, 20000);

it("đổi tên tài khoản mà không ảnh hưởng các khoản giao dịch", async () => {
  server.data.entries = [{ id: "old", type: "expense", amount: 100, category: "Ăn uống", note: "", wallet: "cash", date: "2026-11-01" }];
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", {name:"Mở tài khoản"}));
  await user.click(screen.getByRole("button", {name:"Sửa tên"}));
  await user.type(screen.getByLabelText("Tên hiển thị"), "Mẹ nhỏ");
  await user.click(screen.getByRole("button", {name:"Lưu tên"}));
  await waitFor(() => expect(server.data.displayName).toBe("Mẹ nhỏ"));
  expect((server.data.entries as {amount:number}[])[0].amount).toBe(100);
});

it("cập nhật icon và màu trong danh sách đang mở khi phiên khác thay đổi", async () => {
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", {name:"Mở tài khoản"}));
  await user.click(screen.getByRole("button", {name:"Quản lý danh mục"}));
  server.appearances = [{kind:"expense", category:"Ăn uống", icon_key:"coffee", color_key:"rose", revision:1}];
  fireEvent.focus(window);
  await waitFor(() => {
    const row = screen.getByRole("button", {name:"Sửa danh mục Ăn uống"}).closest(".category-chip");
    expect(row?.querySelector(".category-icon svg")?.getAttribute("class")).toContain("coffee");
  });
  await user.click(screen.getByRole("button", {name:"Sửa danh mục Ăn uống"}));
  expect(screen.getByRole("button", {name:"Icon Cà phê"}).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", {name:"Màu Hồng"}).getAttribute("aria-pressed")).toBe("true");
});

it("không ghi đè tên vừa được thiết bị khác cập nhật", async () => {
  server.data.displayName = "Tên cũ";
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button", {name:"Mở tài khoản"}));
  await user.click(screen.getByRole("button", {name:"Sửa tên"}));
  const input = screen.getByLabelText("Tên hiển thị");
  await user.clear(input); await user.type(input, "Tên đang nhập");
  server.data.displayName = "Tên từ thiết bị khác"; server.version++;
  await user.click(screen.getByRole("button", {name:"Lưu tên"}));
  expect((await screen.findByRole("alert")).textContent).toContain("đã thay đổi trên thiết bị khác");
  expect(server.data.displayName).toBe("Tên từ thiết bị khác");
  expect((input as HTMLInputElement).value).toBe("Tên đang nhập");
});

it("xem chi tiêu theo ngày độc lập với tháng và chỉ tính khoản chi", async () => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  server.data.entries = [
    {id:"e1",type:"expense",amount:40000,category:"Ăn uống",note:"Bữa sáng",wallet:"cash",date:today},
    {id:"e2",type:"expense",amount:60000,category:"Khác",note:"Mua đồ",wallet:"cash",date:today},
    {id:"i1",type:"income",amount:900000,category:"Lương",note:"Lương",wallet:"cash",date:today},
    {id:"old",type:"expense",amount:70000,category:"Khác",note:"Khoản cũ",wallet:"cash",date:"2024-12-31"},
  ];
  const user = userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  const daily = within(screen.getByRole("region", {name:"Chi tiêu theo ngày"}));
  expect((daily.getByLabelText("Ngày") as HTMLInputElement).value).toBe(today);
  expect(daily.getByText(/100\.000/)).toBeTruthy();
  expect(daily.getByText("2 khoản chi")).toBeTruthy();
  await user.click(daily.getByText("Xem 2 khoản chi"));
  expect(daily.getByRole("button", {name:/Bữa sáng/})).toBeTruthy();
  expect(daily.getByRole("button", {name:/Mua đồ/})).toBeTruthy();
  expect(daily.queryByRole("button", {name:/Lương/})).toBeNull();
  fireEvent.change(daily.getByLabelText("Ngày"), {target:{value:"2024-12-31"}});
  expect(screen.getByRole("region", {name:"Chi tiêu theo ngày"}).querySelector(".daily-date-text")?.textContent).toBe("31/12/2024");
  expect(screen.getByRole("region", {name:"Chi tiêu theo ngày"}).querySelector(".daily-total strong")?.textContent).toContain("70.000");
  expect(daily.getByRole("button", {name:/Khoản cũ/})).toBeTruthy();
  await user.click(daily.getByRole("button", {name:"Ngày sau"}));
  expect((daily.getByLabelText("Ngày") as HTMLInputElement).value).toBe("2025-01-01");
  expect(daily.getByText("01/01/2025")).toBeTruthy();
  expect(daily.getByText("Chưa có khoản chi trong ngày này.")).toBeTruthy();
  await user.click(daily.getByRole("button", {name:"Hôm nay"}));
  expect((daily.getByLabelText("Ngày") as HTMLInputElement).value).toBe(today);
  await user.click(screen.getByRole("button", {name:"Tháng trước"}));
  expect(daily.getByText(/100\.000/)).toBeTruthy();
  expect(server.version).toBe(0);
}, 20000);

it("tổng chi trong ngày cập nhật sau khi xóa giao dịch", async () => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  server.data.entries = [{id:"e1",type:"expense",amount:25000,category:"Ăn uống",note:"Ăn trưa",wallet:"cash",date:today}];
  const user = userEvent.setup(); vi.spyOn(window,"confirm").mockReturnValue(true); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  const daily = within(screen.getByRole("region", {name:"Chi tiêu theo ngày"}));
  await user.click(daily.getByText("Xem 1 khoản chi"));
  await user.click(daily.getByRole("button", {name:"Xóa giao dịch"}));
  await waitFor(() => expect(daily.getByText("Chưa có khoản chi trong ngày này.")).toBeTruthy());
  expect(daily.getByText(/0\s*₫/)).toBeTruthy();
});

it("xếp lịch sử, giao dịch gần đây và chi theo ngày cùng thứ tự; sửa không đổi giờ tạo", async () => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const entry = (id:string,note:string,createdAt?:string) => ({id,type:"expense",amount:100,category:"Ăn uống",note,wallet:"cash",date:today,...(createdAt ? {createdAt} : {})});
  server.data.entries = [entry("old","Mới ghi cũ","2026-01-01T01:00:00.000Z"),entry("legacy","Không rõ giờ"),{...entry("new","Mới ghi mới","2026-01-01T02:00:00.000Z"),createdBy:"other"}];
  const user=userEvent.setup(); render(<Page />); await screen.findByText("Đã đồng bộ");
  const names=(element:Element) => Array.from(element.querySelectorAll(".transaction-name strong")).map(e=>e.textContent);
  const recent=screen.getByRole("heading",{name:"Giao dịch gần đây"}).closest("section")!;
  expect(names(recent)).toEqual(["Mới ghi mới","Mới ghi cũ","Không rõ giờ"]);
  const daily=screen.getByRole("region",{name:"Chi tiêu theo ngày"});
  await user.click(within(daily).getByText("Xem 3 khoản chi"));
  expect(names(daily)).toEqual(["Mới ghi mới","Mới ghi cũ","Không rõ giờ"]);
  await user.click(within(daily).getByRole("button",{name:/Mới ghi mới/}));
  const dialog=within(screen.getByRole("dialog"));
  const amount=dialog.getByLabelText(/Số tiền/); await user.clear(amount); await user.type(amount,"200");
  await user.click(dialog.getByRole("button",{name:/Lưu thay đổi/}));
  await waitFor(()=>expect((server.data.entries as {id:string;amount:number}[]).find(e=>e.id==="new")?.amount).toBe(200));
  expect((server.data.entries as {id:string;createdAt?:string;createdBy?:string}[]).find(e=>e.id==="new")).toMatchObject({createdAt:"2026-01-01T02:00:00.000Z",createdBy:"other"});
  await user.click(screen.getAllByRole("button",{name:"Giao dịch"})[0]);
  const history=screen.getByRole("heading",{name:"Tất cả giao dịch"}).closest("section")!;
  expect(names(history)).toEqual(["Mới ghi mới","Mới ghi cũ","Không rõ giờ"]);
},20000);
