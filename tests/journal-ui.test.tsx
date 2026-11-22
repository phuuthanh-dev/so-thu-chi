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
beforeEach(()=>{store.items=[];vi.stubGlobal("confirm",()=>true);vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{if(String(input)==="/api/journal-photos" && init?.method==="POST"){const data=JSON.parse(String(init.body));for(const item of data)store.items.find(e=>e.id===item.entryId)!.photos.push(item.photoId);return Response.json({results:data.map((item:{photoId:string})=>({id:item.photoId,status:200}))});}if(String(input).startsWith("/api/journal-photo?"))return new Response(new Blob(["photo"]),{status:200});return new Response(null,{status:204});}));vi.stubGlobal("URL",Object.assign(URL,{createObjectURL:vi.fn(()=>"blob:test"),revokeObjectURL:vi.fn()}));});
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
it("gửi ảnh theo nhóm và chỉ thử lại ảnh lỗi",async()=>{
 const batches:{ids:string[];complete:(failedIndex:number)=>void}[]=[];
 const fetcher=vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input)==="/api/journal-photos" && init?.method==="POST"){
   const data=JSON.parse(String(init.body)) as {entryId:string;photoId:string}[];
   return new Promise<Response>(resolve=>batches.push({ids:data.map(item=>item.photoId),complete:(failedIndex:number)=>{
    const results=data.map((item,index)=>{if(index!==failedIndex)store.items.find(e=>e.id===item.entryId)!.photos.push(item.photoId);return {id:item.photoId,status:index===failedIndex ? 503 : 200};});
    resolve(Response.json({results}));
   }}));
  }
  return Promise.resolve(new Response(null,{status:204}));
 });
 vi.stubGlobal("fetch",fetcher);const person=userEvent.setup();
 render(<Journal client={client} userId={user} family={family} onRefreshBlockChange={()=>{}}/>);
 await person.click(await screen.findByRole("button",{name:"Viết kỷ niệm"}));const dialog=within(screen.getByRole("dialog"));
 await person.type(dialog.getByLabelText("Tiêu đề"),"Kỷ niệm sáu ảnh");
 await person.upload(dialog.getByLabelText(/Thêm ảnh/),Array.from({length:6},(_,i)=>new File([String(i)],`${i}.jpg`,{type:"image/jpeg"})));
 await person.click(dialog.getByRole("button",{name:"Lưu kỷ niệm"}));
 await waitFor(()=>expect(batches).toHaveLength(1));expect(batches[0].ids).toHaveLength(3);batches[0].complete(0);
 await waitFor(()=>expect(batches).toHaveLength(2));expect(batches[1].ids).toHaveLength(3);batches[1].complete(-1);
 await waitFor(()=>expect(dialog.getByRole("alert").textContent).toContain("Còn 1 ảnh"));expect(store.items[0].photos).toHaveLength(5);
 await person.click(dialog.getByRole("button",{name:"Lưu kỷ niệm"}));await waitFor(()=>expect(batches).toHaveLength(3));
 expect(batches[2].ids).toHaveLength(1);expect(batches[2].ids[0]).not.toBe(batches[0].ids[0]);batches[2].complete(-1);
 await waitFor(()=>expect(store.items[0].photos).toHaveLength(6));
},15000);
it("dùng chung yêu cầu ảnh đang tải và kiểm tra lại khi mở ảnh sau đó",async()=>{
 const photo="bbbbbbbb-0000-0000-0000-000000000401";
 store.items=[{id:"aaaaaaaa-0000-0000-0000-000000000401",ownerId:user,title:"Ảnh chia sẻ",body:"",date:"2026-11-22",visibility:"family",revision:1,createdAt:new Date().toISOString(),authorName:"Bạn",photos:[photo]}];
 let release:(value:Response)=>void=()=>{};let count=0;
 vi.stubGlobal("fetch",vi.fn((input:RequestInfo|URL)=>{
  if(String(input).startsWith("/api/journal-photo?")){count++;if(count===1)return new Promise<Response>(resolve=>{release=resolve;});return Promise.resolve(new Response(null,{status:404}));}
  return Promise.resolve(new Response(null,{status:204}));
 }));
 const person=userEvent.setup();render(<Journal client={client} userId={user} family={family} onRefreshBlockChange={()=>{}}/>);
 await person.click(await screen.findByRole("button",{name:/Ảnh chia sẻ/}));await waitFor(()=>expect(screen.getByRole("dialog")).toBeTruthy());
 await waitFor(()=>expect(count).toBe(1));release(new Response(new Blob(["photo"]),{status:200}));
 await waitFor(()=>expect(within(screen.getByRole("dialog")).getByAltText("Ảnh kỷ niệm 1")).toBeTruthy());
 await person.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Đóng"}));
 await person.click(screen.getByRole("button",{name:/Ảnh chia sẻ/}));
 await waitFor(()=>expect(count).toBe(2));await waitFor(()=>expect(within(screen.getByRole("dialog")).getByLabelText("Không tải được ảnh")).toBeTruthy());
},15000);
