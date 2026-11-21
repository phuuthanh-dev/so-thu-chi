import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TransferForm, transferDelta, type TransferLeg } from "../src/app/wallet-transfers";
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();});
const wallets=[{ref:"p:cash",walletId:"cash",name:"Tiền mặt",ownerId:"u1"},{ref:"f:bank",walletId:"bank",name:"Ví chung",ownerId:"u2"}];
it("tính số dư riêng theo chiều chuyển mà không phụ thuộc danh sách thu chi",()=>{
  const legs=[{ref:"p:cash",direction:"out",amount:400},{ref:"f:bank",direction:"in",amount:400}] as TransferLeg[];
  expect(transferDelta(legs,"p:cash")).toBe(-400);expect(transferDelta(legs,"f:bank")).toBe(400);
});
it("thử lại kết quả chưa xác nhận bằng cùng mã, không gửi hai lần khác nhau",async()=>{
  const rpc=vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValueOnce({data:"ok",error:null});
  const done=vi.fn(async()=>{});render(<TransferForm client={{rpc} as unknown as SupabaseClient} userId="u1" wallets={wallets} onDone={done} onCancel={()=>{}} />);
  const user=userEvent.setup(); await user.type(screen.getByLabelText("Số tiền (₫)"),"40000");
  await user.click(await screen.findByRole("button",{name:"Chuyển tiền"}));
  await screen.findByText(/Chưa xác nhận được kết quả/);
  expect((screen.getByLabelText("Từ ví") as HTMLSelectElement).disabled).toBe(true);
  await user.click(screen.getByRole("button",{name:"Kiểm tra lại"}));
  await waitFor(()=>expect(done).toHaveBeenCalledOnce());
  expect(rpc).toHaveBeenCalledTimes(2);expect(rpc.mock.calls[0][1]).toEqual(rpc.mock.calls[1][1]);
  expect(localStorage.length).toBe(0);
});
it("giữ lần chuyển chưa xác nhận khi mở lại biểu mẫu",async()=>{
  localStorage.setItem("nha-minh-pending-transfer:u1",JSON.stringify({id:"retry-1",source:"p:cash",destination:"f:bank",amount:55}));
  const rpc=vi.fn().mockResolvedValue({data:"ok",error:null});render(<TransferForm client={{rpc} as unknown as SupabaseClient} userId="u1" wallets={wallets} onDone={async()=>{}} onCancel={()=>{}} />);
  await userEvent.click(await screen.findByRole("button",{name:"Kiểm tra lại"}));
  await waitFor(()=>expect(rpc).toHaveBeenCalledWith("wallet_transfer_create",{p_id:"retry-1",p_source:"p:cash",p_destination:"f:bank",p_amount:55}));
});
