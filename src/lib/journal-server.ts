import { createClient } from "@supabase/supabase-js";
import { v2 as cloudinary } from "cloudinary";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function journalSession(request:Request) {
  const token=/^Bearer (.+)$/.exec(request.headers.get("authorization") || "")?.[1];
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !key) return null;
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
  const result=await client.auth.getUser(token);
  return result.error || !result.data.user ? null : {client,user:result.data.user};
}
export type JournalSession = NonNullable<Awaited<ReturnType<typeof journalSession>>>;
export async function cleanupJournalPhotos(session: NonNullable<Awaited<ReturnType<typeof journalSession>>>) {
  if (!process.env.CLOUDINARY_URL) return;
  const result=await session.client.rpc("journal_cleanup_list");
  if (result.error || !Array.isArray(result.data)) return;
  for (const item of result.data.slice(0,32)) {
    if (typeof item.id!=="string" || !UUID.test(item.id)) continue;
    try {
      const deleted=await cloudinary.uploader.destroy(`thu-chi/memories/${session.user.id}/${item.id}`,{type:"authenticated",resource_type:"image",invalidate:true});
      if (deleted.result === "ok" || deleted.result === "not found") await session.client.rpc("journal_cleanup_finish",{p_photo:item.id});
    } catch { /* Leave tombstone for the next cleanup attempt. */ }
  }
}
