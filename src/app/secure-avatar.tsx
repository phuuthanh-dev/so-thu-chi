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
export function SecureAvatar({client,ownerId,avatar,fallback,revision}:{client:SupabaseClient;ownerId:string;avatar?:string|null;fallback:string;revision?:boolean}) {
  const [url,setUrl]=useState<string|null>(null);
  useEffect(()=>{
    if (!avatar?.startsWith("cloudinary:")) return;
    let alive=true; let objectUrl:string | null=null;
    void (async()=>{
      try {
        const token=(await client.auth.getSession()).data.session?.access_token;
        if (!token) return;
        const result=await fetch(`/api/avatar?owner=${encodeURIComponent(ownerId)}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
        if (!result.ok) return;
        objectUrl=URL.createObjectURL(await result.blob());
        if (alive) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl);
      } catch { /* Keep the initials if the photo is temporarily unavailable. */ }
    })();
    return ()=>{alive=false;if(objectUrl) URL.revokeObjectURL(objectUrl);};
  },[client,ownerId,avatar,revision]);
  const legacy = avatar && /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(avatar) ? avatar : null;
  const src=legacy || (avatar?.startsWith("cloudinary:") ? url : null);
  return src ? <Image src={src} alt="" width={40} height={40} unoptimized /> : <>{fallback}</>;
}
