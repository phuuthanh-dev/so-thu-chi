import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture=vi.hoisted(()=>({user:{id:"00000000-0000-0000-0000-000000000201"},allow:true,memberStatus:"active",memberAvatar:"", upload:vi.fn(), download:vi.fn()}));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>({auth:{getUser:async()=>({data:{user:fixture.user},error:null})},rpc:async(name:string)=>name==="account_avatar_upload_reserve" ? {data:fixture.allow,error:null} : name==="family_status" ? {data:{status:fixture.memberStatus,members:[{userId:"00000000-0000-0000-0000-000000000202",avatar:fixture.memberAvatar}]},error:null} : {data:[],error:null}})}));
vi.mock("cloudinary",()=>({v2:{uploader:{upload:fixture.upload},utils:{private_download_url:fixture.download}}}));
import { GET, POST } from "../src/app/api/avatar/route";
beforeEach(()=>{process.env.NEXT_PUBLIC_SUPABASE_URL="https://example.test";process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="test";process.env.CLOUDINARY_URL="cloudinary://example";fixture.allow=true;fixture.memberStatus="active";fixture.memberAvatar="";fixture.upload.mockReset();fixture.download.mockReset();});
afterEach(()=>{vi.unstubAllGlobals();});
it("yêu cầu đăng nhập và từ chối nội dung không phải ảnh",async()=>{
  expect((await POST(new Request("https://app.test/api/avatar",{method:"POST",body:"{}"}))).status).toBe(401);
  const req=new Request("https://app.test/api/avatar",{method:"POST",headers:{authorization:"Bearer token"},body:JSON.stringify({image:"data:image/jpeg;base64,YQ=="})});
  expect((await POST(req)).status).toBe(400);expect(fixture.upload).not.toHaveBeenCalled();
});
it("tải ảnh riêng tư và trả mã tham chiếu thay vì lưu dữ liệu ảnh",async()=>{
  fixture.upload.mockImplementation(async (_image:string,options:{public_id:string})=>({public_id:options.public_id,type:"authenticated",format:"jpg"}));
  const req=new Request("https://app.test/api/avatar",{method:"POST",headers:{authorization:"Bearer token"},body:JSON.stringify({image:"data:image/jpeg;base64,/9j/AA=="})});
  const response=await POST(req); const result=await response.json();
  expect(response.status).toBe(200);expect(result.avatar).toMatch(/^cloudinary:thu-chi\/avatars\/00000000-0000-0000-0000-000000000201\/[0-9a-f-]+\.jpg$/);
  expect(fixture.upload.mock.calls[0][1]).toMatchObject({type:"authenticated",overwrite:false});
});
it("không cấp ảnh thành viên nếu chưa được phép hoặc chủ ảnh không khớp",async()=>{
  const owner="00000000-0000-0000-0000-000000000202";
  fixture.memberStatus="pending";
  expect((await GET(new Request(`https://app.test/api/avatar?owner=${owner}`,{headers:{authorization:"Bearer token"}}))).status).toBe(403);
  fixture.memberStatus="active";fixture.memberAvatar="cloudinary:thu-chi/avatars/00000000-0000-0000-0000-000000000201/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp";
  expect((await GET(new Request(`https://app.test/api/avatar?owner=${owner}`,{headers:{authorization:"Bearer token"}}))).status).toBe(404);
  expect(fixture.download).not.toHaveBeenCalled();
});
it("chỉ trả ảnh Cloudinary đã xác thực cho thành viên được phép",async()=>{
  const owner="00000000-0000-0000-0000-000000000202";
  fixture.memberAvatar=`cloudinary:thu-chi/avatars/${owner}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp`;
  fixture.download.mockReturnValue("https://cloudinary.example/signed");
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(new Uint8Array([1,2,3]),{status:200})));
  const result=await GET(new Request(`https://app.test/api/avatar?owner=${owner}`,{headers:{authorization:"Bearer token"}}));
  expect(result.status).toBe(200);expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(fixture.download).toHaveBeenCalledWith(expect.stringContaining(owner),"webp",expect.objectContaining({type:"authenticated"}));
});
