import { createClient } from "@supabase/supabase-js";
import { v2 as cloudinary } from "cloudinary";
import { createHash, randomUUID } from "node:crypto";

const marker = /^cloudinary:(thu-chi\/avatars\/([0-9a-f-]{36})\/([0-9a-f-]{36}))\.(webp|jpg)$/;
async function authenticated(request: Request) {
  const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") || "")?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !key) return null;
  const client = createClient(url, key, {auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
  const result = await client.auth.getUser(token);
  if (result.error || !result.data.user) return null;
  return {client,user:result.data.user};
}
const unavailable = () => Response.json({error:"Không thể xử lý ảnh. Vui lòng thử lại."},{status:503});
export async function POST(request: Request) {
  const session = await authenticated(request);
  if (!session) return Response.json({error:"Vui lòng đăng nhập."},{status:401});
  if (!process.env.CLOUDINARY_URL) return unavailable();
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 145000) return Response.json({error:"Ảnh quá lớn."},{status:413});
  let image: unknown;
  try { image = (await request.json()).image; } catch { return Response.json({error:"Ảnh không hợp lệ."},{status:400}); }
  if (typeof image !== "string" || image.length > 140000 || !/^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image)) return Response.json({error:"Ảnh không hợp lệ."},{status:400});
  const match = /^data:image\/(webp|jpeg);base64,(.+)$/.exec(image)!;
  const bytes = Buffer.from(match[2],"base64");
  if (bytes.length === 0 || bytes.length > 105000 || (match[1] === "jpeg" ? !(bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) : !(bytes.subarray(0,4).toString()==="RIFF" && bytes.subarray(8,12).toString()==="WEBP"))) return Response.json({error:"Ảnh không hợp lệ."},{status:400});
  const allowed = await session.client.rpc("account_avatar_upload_reserve");
  if (allowed.error || !allowed.data) return Response.json({error:"Bạn đã tải quá nhiều ảnh. Hãy thử lại sau."},{status:429});
  const publicId = `thu-chi/avatars/${session.user.id}/${randomUUID()}`;
  try {
    const result = await cloudinary.uploader.upload(image, {public_id:publicId,asset_folder:"thu-chi/avatars",type:"authenticated",resource_type:"image",overwrite:false});
    if (result.public_id !== publicId || result.type !== "authenticated" || result.format !== (match[1] === "jpeg" ? "jpg" : "webp")) throw new Error("Unexpected upload result");
    return Response.json({avatar:`cloudinary:${publicId}.${result.format}`},{headers:{"Cache-Control":"no-store"}});
  } catch { return unavailable(); }
}
export async function GET(request: Request) {
  const session = await authenticated(request);
  if (!session) return new Response(null,{status:401,headers:{"Cache-Control":"no-store"}});
  if (!process.env.CLOUDINARY_URL) return new Response(null,{status:503});
  const owner = new URL(request.url).searchParams.get("owner") || "";
  if (!/^[0-9a-f-]{36}$/.test(owner)) return new Response(null,{status:400});
  let avatar: unknown;
  if (owner === session.user.id) {
    const result = await session.client.rpc("open_ledger");
    avatar = result.data?.[0]?.data?.avatar;
  } else {
    const result = await session.client.rpc("family_status");
    if (result.error || result.data?.status !== "active") return new Response(null,{status:403,headers:{"Cache-Control":"no-store"}});
    avatar = result.data.members?.find((m:{userId:string}) => m.userId === owner)?.avatar;
  }
  const parsed = typeof avatar === "string" ? marker.exec(avatar) : null;
  if (!parsed || parsed[2] !== owner) return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
  // Authorization is always checked before validating the browser's private cache.
  const etag = `"${createHash("sha256").update(avatar as string).digest("hex")}"`;
  const cacheHeaders = {"Cache-Control":"private, no-cache", "Vary":"Authorization", "ETag":etag, "X-Content-Type-Options":"nosniff"};
  if (request.headers.get("if-none-match")?.split(",").some(value => value.trim() === etag)) return new Response(null,{status:304,headers:cacheHeaders});
  try {
    const signedUrl = cloudinary.utils.private_download_url(parsed[1],parsed[4],{type:"authenticated",resource_type:"image",expires_at:Math.floor(Date.now()/1000)+60,attachment:false});
    const response = await fetch(signedUrl,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000)});
    if (!response.ok) return new Response(null,{status:502});
    return new Response(response.body,{headers:{...cacheHeaders,"Content-Type":`image/${parsed[4] === "jpg" ? "jpeg" : "webp"}`}});
  } catch { return new Response(null,{status:502}); }
}
