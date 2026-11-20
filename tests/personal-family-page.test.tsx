import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
type WalletFixture = {id: string; name: string; balance: number; ownerId?: string; visibility?: string; note?: string};
type EntryFixture = {id: string; wallet: string; type?: string; amount?: number; date?: string; category?: string; note?: string; createdAt?: string};
type AppearanceFixture = {kind:string;category:string;icon_key:string | null;color_key:string | null;revision:number};
type DataFixture = {wallets: WalletFixture[]; entries: EntryFixture[]; rules: unknown[]; budgets: Record<string, number>; categories: {expense: string[]; income: string[]}};
const store = vi.hoisted(() => ({ personal: {} as DataFixture, family: {} as DataFixture, appearances: [] as AppearanceFixture[], familyVersion: 0, personalVersion: 0 }));
vi.mock("../src/app/auth", () => {
  const clone = <T,>(value: T) => structuredClone(value);
  const client = { rpc: async (name: string, args?: {new_data: DataFixture; p_kind:string; p_category:string; p_icon:string | null; p_color:string | null; p_expected_revision:number}): Promise<{data: unknown; error: null}> => {
    if (name === "category_appearances_get") return {data:clone(store.appearances),error:null};
    if (name === "category_appearance_update") { if (!args) throw new Error("missing appearance"); const row={kind:args.p_kind,category:args.p_category,icon_key:args.p_icon,color_key:args.p_color,revision:args.p_expected_revision+1}; store.appearances=[...store.appearances.filter(item=>item.kind!==row.kind || item.category!==row.category),row]; return {data:[row],error:null}; }
    if (name === "family_status") return {data:{id:"family1",name:"Nhà mình",role:"owner",status:"active",members:[{userId:"u1",phone:"Số 1",role:"owner",status:"active"}]},error:null};
    if (name === "recurring_status" || name === "family_recurring_status") return {data:[],error:null};
    if (name === "personal_combined_open") { const owned=store.family.wallets.filter(w => w.ownerId === "u1"); return {data:[{version:`${store.personalVersion}:none:${store.familyVersion}`,data:{...clone(store.personal),wallets:[...clone(store.personal.wallets),...clone(owned)],entries:[...clone(store.personal.entries),...clone(store.family.entries.filter(e => owned.some(w => w.id === e.wallet)))],rules:[]}}],error:null}; }
    if (name === "family_open_ledger") return {data:[{version:store.familyVersion,data:clone(store.family)}],error:null};
    if (name === "personal_combined_save") {
      if (!args) throw new Error("missing save data");
      const foreign = store.family.wallets.filter(w => w.ownerId !== "u1");
      store.family.wallets = clone([...foreign, ...args.new_data.wallets.filter((w:WalletFixture) => w.ownerId)]);
      store.family.entries = clone([...store.family.entries.filter(e => foreign.some(w => w.id === e.wallet)), ...args.new_data.entries.filter((e:EntryFixture) => store.family.wallets.some((w:WalletFixture)=>w.id === e.wallet))]);
      store.personal.wallets = clone(args.new_data.wallets.filter((w:WalletFixture) => !w.ownerId));
      store.personal.entries = clone(args.new_data.entries.filter((e:EntryFixture) => store.personal.wallets.some((w:WalletFixture)=>w.id === e.wallet)));
      store.familyVersion++;
      return client.rpc("personal_combined_open");
    }
    if (name === "family_save_ledger") { if (!args) throw new Error("missing save data"); store.family=clone(args.new_data); store.familyVersion++; return client.rpc("family_open_ledger"); }
    throw Error(`unknown ${name}`);
  }, auth:{signOut:async()=>({error:null})} };
  return {AuthGate:({children}:{children:(client:unknown,user:unknown)=>React.ReactNode}) => children(client,{id:"u1",phone:"Số 1"})};
});
import Page from "../src/app/page";
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); store.appearances=[]; store.personalVersion=0; store.familyVersion=0;
  const categories={expense:["Ăn uống"],income:["Lương"]};
  store.personal={entries:[],wallets:[{id:"cash",name:"Ví cá nhân",balance:100}],budgets:{},rules:[],categories};
  store.family={entries:[],wallets:[{id:"11111111-1111-4111-8111-111111111111",name:"Ví gia đình của tôi",balance:200,ownerId:"u1",visibility:"shared",note:""},{id:"22222222-2222-4222-8222-222222222222",name:"Ví của người kia",balance:300,ownerId:"u2",visibility:"shared",note:""}],budgets:{},rules:[],categories};
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("sidebar switches modes and family wallet edits from personal show in family",async()=>{
  const user=userEvent.setup(); render(<Page />);
  await screen.findByText("Đã đồng bộ");
  await user.click(screen.getAllByRole("button",{name:"Ví của tôi"})[0]);
  expect(screen.getByText("Ví cá nhân")).toBeTruthy(); expect(screen.getByText("Ví gia đình của tôi")).toBeTruthy(); expect(screen.queryByText("Ví của người kia")).toBeNull();
  await user.click(screen.getByRole("button",{name:"Sửa ví Ví gia đình của tôi"}));
  const dialog=screen.getByRole("dialog");
  const name=within(dialog).getByLabelText("Tên ví"); await user.clear(name); await user.type(name,"Ví chung đã sửa");
  vi.spyOn(window,"confirm").mockReturnValue(true);
  await user.click(within(dialog).getByRole("button",{name:"Lưu thay đổi"}));
  await waitFor(()=>expect(store.family.wallets.some(w => w.name === "Ví chung đã sửa")).toBe(true));
  await user.click(screen.getByRole("button",{name:"Chuyển sang sổ gia đình"}));
  await screen.findByRole("button",{name:"Nhà mình"});
  await user.click(screen.getAllByRole("button",{name:"Ví của tôi"})[0]);
  expect(await screen.findByText("Ví chung đã sửa")).toBeTruthy();
  expect(screen.getByText("Ví của người kia")).toBeTruthy();
  expect(screen.queryByText("Ví cá nhân")).toBeNull();
  await user.click(screen.getByRole("button",{name:"Chuyển sang sổ cá nhân"}));
  await screen.findByRole("button",{name:"Không gian của tôi"});
  await user.click(screen.getAllByRole("button",{name:"Ví của tôi"})[0]);
  expect(await screen.findByText("Ví chung đã sửa")).toBeTruthy();
},15000);


it("icon và màu theo tài khoản được giữ khi chuyển sang sổ gia đình",async()=>{
  const user=userEvent.setup(); render(<Page />); await screen.findByText("Đã đồng bộ");
  await user.click(screen.getByRole("button",{name:"Mở tài khoản"}));
  await user.click(screen.getByRole("button",{name:"Quản lý danh mục"}));
  let dialog=within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("button",{name:"Sửa danh mục Ăn uống"}));
  await user.click(dialog.getByRole("button",{name:"Icon Quà tặng"}));
  await user.click(dialog.getByRole("button",{name:"Màu Tím"}));
  await user.click(dialog.getByRole("button",{name:"Lưu thay đổi"}));
  await waitFor(()=>expect(store.appearances[0]?.icon_key).toBe("gift"));
  await user.click(dialog.getByRole("button",{name:"Đóng"}));
  await user.click(screen.getByRole("button",{name:"Chuyển sang sổ gia đình"}));
  await screen.findByRole("button",{name:"Nhà mình"});
  await user.click(screen.getByRole("button",{name:"Mở tài khoản"}));
  await user.click(screen.getByRole("button",{name:"Quản lý danh mục"}));
  dialog=within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("button",{name:"Sửa danh mục Ăn uống"}));
  expect(dialog.getByRole("button",{name:"Icon Quà tặng"}).getAttribute("aria-pressed")).toBe("true");
  expect(dialog.getByRole("button",{name:"Màu Tím"}).getAttribute("aria-pressed")).toBe("true");
},20000);

it("chi theo ngày giữ ngày chọn và cập nhật hai chiều theo phạm vi ví", async () => {
  const shared="11111111-1111-4111-8111-111111111111", other="22222222-2222-4222-8222-222222222222", day="2025-01-05";
  const expense=(id:string,wallet:string,amount:number,note:string) => ({id,wallet,amount,note,type:"expense",date:day,category:"Ăn uống"});
  store.personal.entries=[expense("personal","cash",30000,"Ví cá nhân")];
  store.family.entries=[expense("shared",shared,100000,"Khoản chung"),expense("other",other,50000,"Khoản người kia"),{...expense("income",shared,900000,"Lương"),type:"income"}];
  const user=userEvent.setup(); render(<Page />); await screen.findByText("Đã đồng bộ");
  let daily=within(screen.getByRole("region",{name:"Chi tiêu theo ngày"}));
  fireEvent.change(daily.getByLabelText("Ngày"),{target:{value:day}});
  expect(screen.getByRole("region",{name:"Chi tiêu theo ngày"}).querySelector(".daily-total strong")?.textContent).toContain("130.000");
  await user.click(screen.getByRole("button",{name:"Chuyển sang sổ gia đình"}));
  await screen.findByRole("button",{name:"Nhà mình"});
  daily=within(screen.getByRole("region",{name:"Chi tiêu theo ngày"}));
  expect((daily.getByLabelText("Ngày") as HTMLInputElement).value).toBe(day);
  expect(screen.getByRole("region",{name:"Chi tiêu theo ngày"}).querySelector(".daily-total strong")?.textContent).toContain("150.000");
  await user.click(daily.getByText("Xem 2 khoản chi"));
  await user.click(daily.getByRole("button",{name:/Khoản chung/}));
  let dialog=within(screen.getByRole("dialog")); let amount=dialog.getByLabelText(/Số tiền/);
  await user.clear(amount); await user.type(amount,"120000"); await user.click(dialog.getByRole("button",{name:/Lưu thay đổi/}));
  await waitFor(()=>expect(store.family.entries.find(e=>e.id==="shared")?.amount).toBe(120000));
  await user.click(screen.getByRole("button",{name:"Chuyển sang sổ cá nhân"}));
  await screen.findByRole("button",{name:"Không gian của tôi"});
  daily=within(screen.getByRole("region",{name:"Chi tiêu theo ngày"}));
  expect((daily.getByLabelText("Ngày") as HTMLInputElement).value).toBe(day);
  expect(screen.getByRole("region",{name:"Chi tiêu theo ngày"}).querySelector(".daily-total strong")?.textContent).toContain("150.000");
  await user.click(daily.getByText("Xem 2 khoản chi"));
  await user.click(daily.getByRole("button",{name:/Khoản chung/}));
  dialog=within(screen.getByRole("dialog")); amount=dialog.getByLabelText(/Số tiền/);
  await user.clear(amount); await user.type(amount,"80000"); await user.click(dialog.getByRole("button",{name:/Lưu thay đổi/}));
  await waitFor(()=>expect(store.family.entries.find(e=>e.id==="shared")?.amount).toBe(80000));
  await user.click(screen.getByRole("button",{name:"Chuyển sang sổ gia đình"}));
  await screen.findByRole("button",{name:"Nhà mình"});
  expect(screen.getByRole("region",{name:"Chi tiêu theo ngày"}).querySelector(".daily-total strong")?.textContent).toContain("130.000");
}, 20000);

it("giao dịch cùng ví có cùng thứ tự giờ tạo ở cá nhân và gia đình", async () => {
  const day="2025-01-05", shared="11111111-1111-4111-8111-111111111111";
  const e=(id:string,note:string,createdAt?:string) => ({id,note,wallet:shared,type:"expense",amount:1,date:day,category:"Ăn uống",...(createdAt ? {createdAt} : {})});
  store.family.entries=[e("older","Chung cũ","2025-01-05T01:00:00.000001Z"),e("legacy","Chung chưa rõ"),e("newer","Chung mới","2025-01-05T01:00:00.000999Z")];
  const user=userEvent.setup(); render(<Page />); await screen.findByText("Đã đồng bộ");
  let daily=screen.getByRole("region",{name:"Chi tiêu theo ngày"});
  fireEvent.change(within(daily).getByLabelText("Ngày"),{target:{value:day}});
  await user.click(within(daily).getByText("Xem 3 khoản chi"));
  const names=(node:Element)=>Array.from(node.querySelectorAll(".transaction-name strong")).map(x=>x.textContent);
  expect(names(daily)).toEqual(["Chung mới","Chung cũ","Chung chưa rõ"]);
  await user.click(screen.getByRole("button",{name:"Chuyển sang sổ gia đình"}));
  await screen.findByRole("button",{name:"Nhà mình"});
  daily=screen.getByRole("region",{name:"Chi tiêu theo ngày"});
  expect((within(daily).getByLabelText("Ngày") as HTMLInputElement).value).toBe(day);
  await user.click(within(daily).getByText("Xem 3 khoản chi"));
  expect(names(daily)).toEqual(["Chung mới","Chung cũ","Chung chưa rõ"]);
},15000);
