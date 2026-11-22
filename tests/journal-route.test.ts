import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture=vi.hoisted(()=>({access:null as null | {ownerId:string;id:string;format:string}, reserve:"reserved", upload:vi.fn(), download:vi.fn(), rpc:vi.fn()}));
vi.mock("../src/lib/journal-server",()=>({UUID:/^[0-9a-f-]{36}$/i,journalSession:async(req:Request)=>req.headers.has("authorization") ? {user:{id:"00000000-0000-0000-0000-000000000401"},client:{rpc:fixture.rpc}} : null}));
vi.mock("cloudinary",()=>({v2:{uploader:{upload:fixture.upload},utils:{private_download_url:fixture.download}}}));
import {GET,POST} from "../src/app/api/journal-photo/route";
const photo="bbbbbbbb-0000-0000-0000-000000000401",entry="aaaaaaaa-0000-0000-0000-000000000401",owner="00000000-0000-0000-0000-000000000401";
beforeEach(()=>{process.env.CLOUDINARY_URL="cloudinary://demo";fixture.access=null;fixture.reserve="reserved";fixture.rpc.mockReset().mockImplementation(async(name:string)=>name==="journal_photo_access" ? {data:fixture.access,error:null} : name==="journal_photo_reserve" ? {data:fixture.reserve,error:null} : {data:true,error:null});fixture.upload.mockReset();fixture.download.mockReset();});
afterEach(()=>vi.unstubAllGlobals());
it("không tải hoặc xem ảnh nếu chưa đăng nhập và từ chối dữ liệu ảnh sai",async()=>{
 expect((await GET(new Request(`https://app.test/api/journal-photo?id=${photo}`))).status).toBe(401);
 const invalid=new Request("https://app.test/api/journal-photo",{method:"POST",headers:{Authorization:"Bearer token"},body:JSON.stringify({entryId:entry,photoId:photo,image:"data:image/jpeg;base64,YQ=="})});
 expect((await POST(invalid)).status).toBe(400);expect(fixture.upload).not.toHaveBeenCalled();
});
it("lưu ảnh Cloudinary authenticated sau khi kiểm tra quyền bài viết",async()=>{
 fixture.upload.mockImplementation(async(_img:string,options:{public_id:string})=>({public_id:options.public_id,type:"authenticated",format:"jpg"}));
 const request=new Request("https://app.test/api/journal-photo",{method:"POST",headers:{Authorization:"Bearer token"},body:JSON.stringify({entryId:entry,photoId:photo,image:"data:image/jpeg;base64,/9j/AA=="})});
 expect((await POST(request)).status).toBe(200);expect(fixture.rpc).toHaveBeenCalledWith("journal_photo_reserve",{p_entry:entry,p_photo:photo,p_format:"jpg"});
 expect(fixture.upload).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({public_id:`thu-chi/memories/${owner}/${photo}`,type:"authenticated",overwrite:false}));
 expect(fixture.rpc).toHaveBeenCalledWith("journal_photo_finish",{p_photo:photo,p_success:true});
});
it("từ chối ảnh đã mất quyền ngay cả khi trình duyệt có bản cache",async()=>{
 fixture.access={ownerId:owner,id:photo,format:"jpg"};fixture.download.mockReturnValue("https://example.test/photo");
 const fetchMock=vi.fn(async()=>new Response(new Uint8Array([1,2,3]),{status:200}));vi.stubGlobal("fetch",fetchMock);
 const first=await GET(new Request(`https://app.test/api/journal-photo?id=${photo}`,{headers:{Authorization:"Bearer token"}}));expect(first.status).toBe(200);const etag=first.headers.get("etag")!;
 fixture.access=null;
 const revoked=await GET(new Request(`https://app.test/api/journal-photo?id=${photo}`,{headers:{Authorization:"Bearer token","If-None-Match":etag}}));
 expect(revoked.status).toBe(404);expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("đưa ảnh lỗi vào hàng chờ dọn dẹp",async()=>{
 fixture.upload.mockRejectedValue(new Error("offline"));
 const request=new Request("https://app.test/api/journal-photo",{method:"POST",headers:{Authorization:"Bearer token"},body:JSON.stringify({entryId:entry,photoId:photo,image:"data:image/jpeg;base64,/9j/AA=="})});
 expect((await POST(request)).status).toBe(503);expect(fixture.rpc).toHaveBeenCalledWith("journal_photo_finish",{p_photo:photo,p_success:false});
});

it("không tải trùng một ảnh khi yêu cầu trước còn xử lý",async()=>{
 fixture.reserve="pending";
 const request=new Request("https://app.test/api/journal-photo",{method:"POST",headers:{Authorization:"Bearer token"},body:JSON.stringify({entryId:entry,photoId:photo,image:"data:image/jpeg;base64,/9j/AA=="})});
 expect((await POST(request)).status).toBe(409);expect(fixture.upload).not.toHaveBeenCalled();
});
