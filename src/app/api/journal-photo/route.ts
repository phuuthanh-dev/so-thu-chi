import { v2 as cloudinary } from "cloudinary";
import { createHash } from "node:crypto";
import { UUID, journalSession } from "@/lib/journal-server";
import {uploadJournalPhotos} from "@/lib/journal-photo-upload";
const noStore={"Cache-Control":"no-store"};
export async function POST(request:Request) {
  const session=await journalSession(request);
  if (!session) return Response.json({error:"Vui lòng đăng nhập."},{status:401,headers:noStore});
  if (!process.env.CLOUDINARY_URL) return Response.json({error:"Không thể tải ảnh. Hãy thử lại."},{status:503});
  if (Number(request.headers.get("content-length") || 0)>1_300_000) return Response.json({error:"Ảnh quá lớn."},{status:413});
  let data:{entryId?:unknown;photoId?:unknown;image?:unknown};
  try { data=await request.json(); } catch { return Response.json({error:"Ảnh không hợp lệ."},{status:400}); }
  if(!data || typeof data!=="object" || Array.isArray(data)) return Response.json({error:"Ảnh không hợp lệ."},{status:400,headers:noStore});
  const [result]=await uploadJournalPhotos(session,[data]);
  return Response.json(result.status===200 ? {id:result.id} : {error:result.error},{status:result.status,headers:noStore});
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
