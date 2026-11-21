import React from "react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {act,cleanup,render,screen,waitFor} from "@testing-library/react";
import type {SupabaseClient} from "@supabase/supabase-js";
import {SecureAvatar} from "../src/app/secure-avatar";
vi.mock("next/image",()=>({default:({src,alt}:{src:string;alt:string})=>React.createElement("img",{src,alt})}));
const client=(token:string)=>({auth:{getSession:async()=>({data:{session:{access_token:token}}})}} as unknown as SupabaseClient);
const avatar="cloudinary:thu-chi/avatars/one/a.webp";
beforeEach(()=>{vi.stubGlobal("URL",{createObjectURL:vi.fn().mockReturnValue("blob:loaded"),revokeObjectURL:vi.fn()});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("gộp các yêu cầu ảnh trùng trên cùng phiên",async()=>{
 let finish!:(r:Response)=>void; const fetchMock=vi.fn<typeof fetch>(()=>new Promise<Response>(resolve=>{finish=resolve;}));vi.stubGlobal("fetch",fetchMock);
 const c=client("viewer-token");const node=()=> <SecureAvatar client={c} ownerId="one" avatar={avatar} fallback="M" />;
 render(<>{node()}{node()}{node()}</>);
 await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
 await act(async()=>{finish(new Response(new Blob(["image"]),{status:200}));});
 await waitFor(()=>expect(screen.getAllByRole("presentation")).toHaveLength(3));
 expect(fetchMock.mock.calls[0][1]).toMatchObject({cache:"no-cache",headers:{Authorization:"Bearer viewer-token"}});
});
it("không chia sẻ yêu cầu giữa các phiên khác nhau",async()=>{
 const pending:((r:Response)=>void)[]=[]; const fetchMock=vi.fn(()=>new Promise<Response>(resolve=>{pending.push(resolve);}));vi.stubGlobal("fetch",fetchMock);
 render(<><SecureAvatar client={client("token-a")} ownerId="one" avatar={avatar} fallback="A"/><SecureAvatar client={client("token-b")} ownerId="one" avatar={avatar} fallback="B"/></>);
 await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
 await act(async()=>{pending.forEach(resolve=>resolve(new Response(new Blob(["image"]),{status:200})));});
});
it("không hiển thị ảnh cũ khi ảnh đại diện thay đổi",async()=>{
 const waiters:((r:Response)=>void)[]=[];vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(resolve=>waiters.push(resolve))));
 const c=client("token-swap");const view=render(<SecureAvatar client={c} ownerId="one" avatar={avatar} fallback="M"/>);
 await waitFor(()=>expect(waiters).toHaveLength(1));
 view.rerender(<SecureAvatar client={c} ownerId="one" avatar="cloudinary:thu-chi/avatars/one/b.webp" fallback="M"/>);
 await waitFor(()=>expect(waiters).toHaveLength(2));
 await act(async()=>{waiters[0](new Response(new Blob(["old"]),{status:200}));});
 expect(screen.queryByRole("presentation")).toBeNull();
 await act(async()=>{waiters[1](new Response(new Blob(["new"]),{status:200}));});
 await waitFor(()=>expect(screen.getByRole("presentation")).toBeTruthy());
});
