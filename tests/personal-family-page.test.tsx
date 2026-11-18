import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
type WalletFixture = {id: string; name: string; balance: number; ownerId?: string; visibility?: string; note?: string};
type EntryFixture = {id: string; wallet: string};
type DataFixture = {wallets: WalletFixture[]; entries: EntryFixture[]; rules: unknown[]; budgets: Record<string, number>; categories: {expense: string[]; income: string[]}};
const store = vi.hoisted(() => ({ personal: {} as DataFixture, family: {} as DataFixture, familyVersion: 0, personalVersion: 0 }));
vi.mock("../src/app/auth", () => {
  const clone = <T,>(value: T) => structuredClone(value);
  const client = { rpc: async (name: string, args?: {new_data: DataFixture}): Promise<{data: unknown; error: null}> => {
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
  localStorage.clear(); sessionStorage.clear(); store.personalVersion=0; store.familyVersion=0;
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
