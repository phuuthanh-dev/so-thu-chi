import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FamilyManager, captureFamilyInvitation, type Family } from "../src/app/family";

afterEach(() => { cleanup(); sessionStorage.clear(); history.replaceState(null, "", "/"); vi.restoreAllMocks(); });
const active: Family = { id:"family", name:"Gia đình nhỏ", role:"owner", status:"active", members:[{userId:"u1",displayName:"Mẹ",role:"owner",status:"active"},{userId:"u2",displayName:"Bố",avatar:"data:image/webp;base64,YQ==",role:"member",status:"active"}] };
function setup(rpc: ReturnType<typeof vi.fn>, family: Family | null = active) {
  return render(<FamilyManager client={{rpc} as unknown as SupabaseClient} userId="u1" family={family} onFamily={() => {}} personal wallets={[{id:"cash",name:"Tiền mặt"}]} personalVersion={() => 7} disabled={false} refresh={async () => {}} switchWorkspace={() => {}} />);
}
it("lưu lời mời trong phiên và xóa khỏi URL", () => {
  const token = "a".repeat(64); history.replaceState(null, "", `/#moi=${token}`); captureFamilyInvitation();
  expect(location.hash).toBe(""); expect(sessionStorage.getItem("nha-minh-family-invitation")).toBe(token);
});
it("chỉ gửi yêu cầu tham gia khi người được mời chủ động chọn", async () => {
  sessionStorage.setItem("nha-minh-family-invitation", "a".repeat(64));
  const rpc = vi.fn(async (name: string) => ({ data: name === "family_status" ? null : "Nhà", error:null }));
  setup(rpc, null); const user = userEvent.setup();
  const button = await screen.findByRole("button", {name:"Gửi yêu cầu"});
  expect(rpc).not.toHaveBeenCalledWith("family_request_join", expect.anything());
  await user.click(button);
  await waitFor(() => expect(rpc).toHaveBeenCalledWith("family_request_join", {invite_token:"a".repeat(64)}));
  expect(sessionStorage.getItem("nha-minh-family-invitation")).toBeNull();
});
it("chuyển ví dùng phiên bản hiện tại và lựa chọn riêng tư của người dùng", async () => {
  const rpc = vi.fn(async (name: string) => ({data:name === "family_status" ? active : name === "family_open_ledger" ? [{version:9,data:{}}] : 1,error:null}));
  vi.spyOn(window, "confirm").mockReturnValue(true); setup(rpc); const user = userEvent.setup();
  await user.click(await screen.findByRole("checkbox", {name:"Tiền mặt"}));
  await user.selectOptions(screen.getByLabelText("Chủ sở hữu"), "u2");
  await user.selectOptions(screen.getByLabelText("Quyền xem"), "shared");
  await user.click(screen.getByRole("button", {name:"Chuyển ví đã chọn"}));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith("family_transfer_wallets_v2", { expected_personal_version:7,expected_family_version:9,choices:[{walletId:"cash",ownerId:"u2",visibility:"shared"}] }));
});

it("hiển thị tên và ảnh thành viên thay cho số điện thoại", async () => {
  const rpc = vi.fn(async () => ({data:active,error:null})); setup(rpc);
  expect(await screen.findByText("Mẹ (Bạn)")).toBeTruthy();
  expect(screen.getByText("Bố")).toBeTruthy();
  expect(document.querySelector('.member-avatar img')?.getAttribute('src')).toBe('data:image/webp;base64,YQ==');
  expect(screen.queryByText('+84222')).toBeNull();
});
