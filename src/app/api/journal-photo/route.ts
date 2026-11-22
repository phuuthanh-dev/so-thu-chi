import { v2 as cloudinary } from "cloudinary";
import { createHash } from "node:crypto";
import { UUID, journalSession } from "@/lib/journal-server";
const noStore={"Cache-Control":"no-store"};
export async function POST(request:Request) {
  const session=await journalSession(request);
  if (!session) return Response.json({error:"Vui lòng đăng nhập."},{status:401,headers:noStore});
  if (!process.env.CLOUDINARY_URL) return Response.json({error:"Không thể tải ảnh. Hãy thử lại."},{status:503});
  if (Number(request.headers.get("content-length") || 0)>1_300_000) return Response.json({error:"Ảnh quá lớn."},{status:413});
  let data:{entryId?:unknown;photoId?:unknown;image?:unknown};
  try { data=await request.json(); } catch { return Response.json({error:"Ảnh không hợp lệ."},{status:400}); }
  if (typeof data.entryId!=="string" || !UUID.test(data.entryId) || typeof data.photoId!=="string" || !UUID.test(data.photoId) || typeof data.image!=="string" || data.image.length>1_250_000) return Response.json({error:"Ảnh không hợp lệ."},{status:400});
  const match=/^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(data.image);
  if (!match) return Response.json({error:"Ảnh không hợp lệ."},{status:400});
  const bytes=Buffer.from(match[2],"base64"), format=match[1]==="jpeg" ? "jpg" : "webp";
  if (!bytes.length || bytes.length>900_000 || (format==="jpg" ? !(bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) : !(bytes.subarray(0,4).toString()==="RIFF" && bytes.subarray(8,12).toString()==="WEBP"))) return Response.json({error:"Ảnh không hợp lệ."},{status:400});
  const reserved=await session.client.rpc("journal_photo_reserve",{p_entry:data.entryId,p_photo:data.photoId,p_format:format});
  if (reserved.error) return Response.json({error:"Không thể thêm ảnh. Mỗi bài tối đa 8 ảnh."},{status:400});
  if (reserved.data==="ready") return Response.json({id:data.photoId},{headers:noStore});
  if (reserved.data==="expired") return Response.json({error:"Ảnh chưa tải xong. Hãy thử lại."},{status:410,headers:noStore});
  if (reserved.data!=="reserved") return Response.json({error:"Ảnh đang được xử lý. Hãy thử lại sau."},{status:409,headers:noStore});
  const publicId=`thu-chi/memories/${session.user.id}/${data.photoId}`;
  try {
    const uploaded=await cloudinary.uploader.upload(data.image,{public_id:publicId,asset_folder:"thu-chi/memories",type:"authenticated",resource_type:"image",overwrite:false});
    if (uploaded.public_id!==publicId || uploaded.type!=="authenticated" || uploaded.format!==format) throw new Error("Unexpected upload result");
    const finished=await session.client.rpc("journal_photo_finish",{p_photo:data.photoId,p_success:true});
    if (finished.error || !finished.data) throw new Error("Unable to attach photo");
    return Response.json({id:data.photoId},{headers:noStore});
  } catch {
    await session.client.rpc("journal_photo_finish",{p_photo:data.photoId,p_success:false});
    return Response.json({error:"Không tải được ảnh. Bạn có thể thử lại."},{status:503,headers:noStore});
  }
}
export async function GET(request:Request) {
  const session=await journalSession(request);
  if (!session) return new Response(null,{status:401,headers:noStore});
  if (!process.env.CLOUDINARY_URL) return new Response(null,{status:503,headers:noStore});
  const photo=new URL(request.url).searchParams.get("id") || "";
  if (!UUID.test(photo)) return new Response(null,{status:400,headers:noStore});
  const access=await session.client.rpc("journal_photo_access",{p_photo:photo});
  const info=access.data;
  if (access.error || !info || info.id!==photo || typeof info.ownerId!=="string" || !UUID.test(info.ownerId) || !["jpg","webp"].includes(info.format)) return new Response(null,{status:404,headers:noStore});
  const publicId=`thu-chi/memories/${info.ownerId}/${photo}`;
  const etag=`"${createHash("sha256").update(publicId+info.format).digest("hex")}"`;
  const headers={"Cache-Control":"private, no-cache","Vary":"Authorization","ETag":etag,"X-Content-Type-Options":"nosniff"};
  if (request.headers.get("if-none-match")?.split(",").some(value=>value.trim()===etag)) return new Response(null,{status:304,headers});
  try {
    const signed=cloudinary.utils.private_download_url(publicId,info.format,{type:"authenticated",resource_type:"image",expires_at:Math.floor(Date.now()/1000)+60,attachment:false});
    const response=await fetch(signed,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10000)});
    if (!response.ok) return new Response(null,{status:502,headers:noStore});
    return new Response(response.body,{headers:{...headers,"Content-Type":info.format==="jpg" ? "image/jpeg" : "image/webp"}});
  } catch { return new Response(null,{status:502,headers:noStore}); }
}
