"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function uploadAvatar(client: SupabaseClient, image: string): Promise<string> {
  const session=await client.auth.getSession();
  const token=session.data.session?.access_token;
  if (!token) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
  const result=await fetch("/api/avatar",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({image})});
  if (!result.ok) throw new Error("Không tải được ảnh. Hãy kiểm tra kết nối và thử lại.");
  const data=await result.json();
  if (typeof data.avatar !== "string" || !data.avatar.startsWith("cloudinary:thu-chi/avatars/")) throw new Error("Không nhận được ảnh đã tải.");
  return data.avatar;
}
// Only share requests while they are in flight; the browser revalidates its
// private cache with the server before reusing an image after a page reload.
const pendingAvatars = new Map<string, Promise<Blob>>();
function loadAvatar(token: string, ownerId: string, avatar: string, revision?: boolean): Promise<Blob> {
  const key = JSON.stringify([token, ownerId, avatar, revision]);
  const pending = pendingAvatars.get(key);
  if (pending) return pending;
  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const result = await fetch(`/api/avatar?owner=${encodeURIComponent(ownerId)}`, {headers:{Authorization:`Bearer ${token}`},cache:"no-cache",signal:controller.signal});
      if (!result.ok) throw new Error("Avatar unavailable");
      return await result.blob();
    } finally { clearTimeout(timer); }
  })();
  pendingAvatars.set(key, request);
  void request.finally(() => { if (pendingAvatars.get(key) === request) pendingAvatars.delete(key); }).catch(() => {});
  return request;
}
export function SecureAvatar({client,ownerId,avatar,fallback,revision}:{client:SupabaseClient;ownerId:string;avatar?:string|null;fallback:string;revision?:boolean}) {
  const [loaded,setLoaded]=useState<{url:string;avatar:string;ownerId:string}|null>(null);
  useEffect(()=>{
    if (!avatar?.startsWith("cloudinary:")) return;
    let alive=true; let objectUrl:string | null=null;
    void (async()=>{
      try {
        const token=(await client.auth.getSession()).data.session?.access_token;
        if (!token || !alive) return;
        const blob=await loadAvatar(token,ownerId,avatar,revision);
        if (!alive) return;
        objectUrl=URL.createObjectURL(blob);
        setLoaded({url:objectUrl,avatar,ownerId});
      } catch { /* Keep the initials if the photo is temporarily unavailable. */ }
    })();
    return ()=>{alive=false;if(objectUrl) URL.revokeObjectURL(objectUrl);};
  },[client,ownerId,avatar,revision]);
  const legacy = avatar && /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(avatar) ? avatar : null;
  const src=legacy || (loaded && loaded.avatar === avatar && loaded.ownerId === ownerId ? loaded.url : null);
  return src ? <Image src={src} alt="" width={40} height={40} unoptimized /> : <>{fallback}</>;
}
