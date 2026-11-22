import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Family} from "../src/app/family";
vi.mock("../src/lib/journal-photo",()=>({prepareJournalPhoto:vi.fn(async()=>"data:image/jpeg;base64,/9j/AA==")}));
import {Journal} from "../src/app/journal";
type Memory={id:string;ownerId:string;title:string;body:string;date:string;visibility:string;revision:number;createdAt:string;authorName:string;photos:string[]};
const store:{items:Memory[]}={items:[]};
const user="00000000-0000-0000-0000-000000000401";
const client={auth:{getSession:async()=>({data:{session:{access_token:"test"}}})},rpc:vi.fn(async(name:string,args?:Record<string,unknown>)=>{
 if(name==="journal_list")return {data:structuredClone(store.items),error:null};
 if(name==="journal_save" && args){const old=store.items.find(e=>e.id===args.p_id);const entry={id:String(args.p_id),ownerId:user,title:String(args.p_title),body:String(args.p_body),date:String(args.p_date),visibility:String(args.p_visibility),revision:(old?.revision || 0)+1,createdAt:new Date().toISOString(),authorName:"Bạn",photos:old?.photos || []};store.items=[entry,...store.items.filter(e=>e.id!==entry.id)];return {data:entry.revision,error:null};}
 if(name==="journal_delete" && args){store.items=store.items.filter(e=>e.id!==args.p_id);return {data:true,error:null};}
 if(name==="journal_photo_delete" && args){store.items=store.items.map(e=>({...e,photos:e.photos.filter(p=>p!==args.p_photo)}));return {data:true,error:null};}
 throw new Error(`Unexpected ${name}`);
})} as unknown as SupabaseClient;
const family={id:"family",name:"Nhà mình",role:"owner",status:"active",members:[]} as Family;
beforeEach(()=>{store.items=[];vi.stubGlobal("confirm",()=>true);vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{if(String(input)==="/api/journal-photo" && init?.method==="POST"){const data=JSON.parse(String(init.body));const entry=store.items.find(e=>e.id===data.entryId)!;entry.photos.push(data.photoId);return Response.json({id:data.photoId});}if(String(input).startsWith("/api/journal-photo?"))return new Response(new Blob(["photo"]),{status:200});return new Response(null,{status:204});}));vi.stubGlobal("URL",Object.assign(URL,{createObjectURL:vi.fn(()=>"blob:test"),revokeObjectURL:vi.fn()}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
it("tạo bài chia sẻ nhiều ảnh và đồng bộ sang phiên khác",async()=>{
 const first=render(<Journal client={client} userId={user} family={family} onRefreshBlockChange={()=>{}}/>);const second=render(<Journal client={client} userId={user} family={family} onRefreshBlockChange={()=>{}}/>);const a=within(first.container),b=within(second.container);const person=userEvent.setup();
 await person.click(await a.findByRole("button",{name:"Viết kỷ niệm"}));let dialog=within(a.getByRole("dialog"));
 await person.type(dialog.getByLabelText("Tiêu đề"),"Ngày đi biển");await person.type(dialog.getByLabelText("Câu chuyện"),"Nắng và biển");
 fireEvent.change(dialog.getByLabelText("Ngày kỷ niệm"),{target:{value:"2026-10-15"}});expect(dialog.getByText("15/10/2026")).toBeTruthy();
 await person.click(dialog.getByLabelText(/Gia đình/));
 await person.upload(dialog.getByLabelText(/Thêm ảnh/),[new File(["a"],"a.jpg",{type:"image/jpeg"}),new File(["b"],"b.png",{type:"image/png"})]);
 await person.click(dialog.getByRole("button",{name:"Lưu kỷ niệm"}));
 await waitFor(()=>expect(store.items[0]?.photos).toHaveLength(2));expect(store.items[0].visibility).toBe("family");expect(store.items[0].date).toBe("2026-10-15");
 window.dispatchEvent(new Event("focus"));await b.findByRole("button",{name:/Ngày đi biển/});
 await person.click(b.getByRole("button",{name:/Ngày đi biển/}));dialog=within(b.getByRole("dialog"));expect(dialog.getByText("Nắng và biển")).toBeTruthy();expect(dialog.getByText(/Chia sẻ với gia đình/)).toBeTruthy();
},15000);
it("bài riêng tư là mặc định và không cho chia sẻ khi chưa có gia đình",async()=>{
 const person=userEvent.setup();render(<Journal client={client} userId={user} family={null} onRefreshBlockChange={()=>{}}/>);await person.click(await screen.findByRole("button",{name:"Viết kỷ niệm"}));const dialog=within(screen.getByRole("dialog"));
 expect((dialog.getByLabelText(/Riêng tư/) as HTMLInputElement).checked).toBe(true);expect((dialog.getByLabelText(/Gia đình/) as HTMLInputElement).disabled).toBe(true);
});
