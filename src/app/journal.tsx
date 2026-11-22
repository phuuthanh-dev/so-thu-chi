"use client";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, LockKeyhole, Pencil, Trash2, UsersRound, X } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Family } from "./family";
import { prepareJournalPhoto } from "@/lib/journal-photo";
import { JournalView, type JournalCardData } from "./journal-view";
import "./journal.css";

type Memory = {id:string;ownerId:string;title:string;body:string;date:string;visibility:"private"|"family";revision:number;createdAt:string;authorName:string;photos:string[]};
type PhotoFile = {id:string;file:File;preview:string};
type Editor = {id:string;revision:number;title:string;body:string;date:string;visibility:"private"|"family";photos:string[]};
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
const tokenFor=async(client:SupabaseClient)=>{
  const token=(await client.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("Phiên đăng nhập hết hạn. Hãy đăng nhập lại.");
  return token;
};
const cleanup=async(client:SupabaseClient)=>{try {const token=await tokenFor(client);await fetch("/api/journal-cleanup",{method:"POST",headers:{Authorization:`Bearer ${token}`}});} catch {/* Retry on a later visit. */}};
function MemoryPhoto({client,id,alt}:{client:SupabaseClient;id:string;alt:string}) {
  const [url,setUrl]=useState<string|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{let alive=true, blobUrl:string|undefined;const controller=new AbortController();
    void (async()=>{try {const token=await tokenFor(client); const response=await fetch(`/api/journal-photo?id=${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-cache",signal:controller.signal}); if(!response.ok) throw new Error();const blob=await response.blob();if(!alive)return;blobUrl=URL.createObjectURL(blob);setUrl(blobUrl);}catch{if(alive && !controller.signal.aborted)setFailed(true);}})();
    return ()=>{alive=false;controller.abort();if(blobUrl)URL.revokeObjectURL(blobUrl);};
  },[client,id]);
  return url ? <Image src={url} alt={alt} fill unoptimized sizes="(max-width:600px) 120px, 400px" /> : <span className="memory-image-placeholder" role="img" aria-label={failed ? "Không tải được ảnh" : "Đang tải ảnh"}><ImagePlus size={22} aria-hidden="true"/>{failed && <small>Chưa tải được ảnh</small>}</span>;
}
export function Journal({client,userId,family,onRefreshBlockChange}:{client:SupabaseClient;userId:string;family:Family|null;onRefreshBlockChange:(blocked:boolean)=>void}) {
  const [items,setItems]=useState<Memory[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [filter,setFilter]=useState<"all"|"private"|"family">("all"),[detail,setDetail]=useState<string|null>(null),[editor,setEditor]=useState<Editor|null>(null);
  const [pending,setPending]=useState<PhotoFile[]>([]),[remove,setRemove]=useState<string[]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const editorDialog=useRef<HTMLFormElement>(null), detailDialog=useRef<HTMLElement>(null);
  const pendingRef=useRef<PhotoFile[]>([]),live=useRef(true),sequence=useRef(0),busyRef=useRef(false),editorRef=useRef<Editor|null>(null);
  useEffect(()=>{pendingRef.current=pending;},[pending]);
  useEffect(()=>{editorRef.current=editor;},[editor]);
  useEffect(()=>{live.current=true;return ()=>{live.current=false;pendingRef.current.forEach(p=>URL.revokeObjectURL(p.preview));};},[]);
  useEffect(()=>{onRefreshBlockChange(!!editor || busy);return ()=>onRefreshBlockChange(false);},[editor,busy,onRefreshBlockChange]);
  const load=useCallback(async(force=false)=>{
    if(!force && (busyRef.current || editorRef.current)) return;
    const request=++sequence.current;
    try {const result=await client.rpc("journal_list"); if(result.error || !Array.isArray(result.data)) throw result.error || new Error("Invalid response");
      if(live.current && request===sequence.current){setItems(result.data as Memory[]);setError("");setLoading(false);}
    } catch {if(live.current && request===sequence.current){setError("Chưa tải được kỷ niệm. Hãy kiểm tra kết nối.");setLoading(false);}}
  },[client]);
  useEffect(()=>{void Promise.resolve().then(()=>{void load(true);void cleanup(client);});const timer=window.setInterval(()=>void load(),20000);const focus=()=>void load();window.addEventListener("focus",focus);return ()=>{window.clearInterval(timer);window.removeEventListener("focus",focus);};},[client,load]);
  const isEditing=!!editor, hasDetail=!!detail;
  useEffect(()=>{
    const dialog=isEditing ? editorDialog.current : hasDetail ? detailDialog.current : null;
    if(!dialog)return;
    const previous=document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const candidates=()=>Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'));
    candidates()[0]?.focus();
    const trap=(event:KeyboardEvent)=>{
      if(event.key!=="Tab")return;
      const items=candidates();if(!items.length){event.preventDefault();return;}
      const first=items[0],last=items[items.length-1];
      if(event.shiftKey && (document.activeElement===first || !dialog.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey && (document.activeElement===last || !dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    document.addEventListener("keydown",trap);
    return ()=>{document.removeEventListener("keydown",trap);if(previous?.isConnected)previous.focus();};
  },[isEditing,hasDetail]);
  const clearPending=()=>{pendingRef.current.forEach(p=>URL.revokeObjectURL(p.preview));pendingRef.current=[];setPending([]);setRemove([]);};
  const startNew=()=>{clearPending();setMessage("");setEditor({id:crypto.randomUUID(),revision:0,title:"",body:"",date:today(),visibility:"private",photos:[]});};
  const selected=items.find(item=>item.id===detail);
  const startEdit=(entry:Memory)=>{clearPending();setMessage("");setDetail(null);setEditor({id:entry.id,revision:entry.revision,title:entry.title,body:entry.body,date:entry.date,visibility:entry.visibility,photos:entry.photos});};
  const closeEditor=()=>{if(busyRef.current)return;if(editor && (editor.title.trim() || editor.body.trim() || pending.length || remove.length) && !confirm("Đóng bài đang viết? Những thay đổi chưa lưu sẽ mất."))return;clearPending();setEditor(null);setMessage("");};
  useEffect(()=>{if(!detail && !editor)return;const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape" && !busyRef.current){if(editor){if(!confirm("Đóng bài đang viết? Những thay đổi chưa lưu sẽ mất."))return;clearPending();setEditor(null);}else setDetail(null);}};window.addEventListener("keydown",onKey);return ()=>window.removeEventListener("keydown",onKey);},[detail,editor]);
  const chooseFiles=(event:React.ChangeEvent<HTMLInputElement>)=>{
    const files=Array.from(event.target.files || []);event.target.value="";
    if(!editor)return;
    if(editor.photos.length-remove.length+pending.length+files.length>8){setMessage("Mỗi kỷ niệm có tối đa 8 ảnh.");return;}
    if(files.some(f=>!["image/jpeg","image/png","image/webp"].includes(f.type) || f.size>10*1024*1024)){setMessage("Chọn ảnh JPG, PNG hoặc WebP, tối đa 10 MB mỗi ảnh.");return;}
    setMessage("");setPending(current=>[...current,...files.map(file=>({id:crypto.randomUUID(),file,preview:URL.createObjectURL(file)}))]);
  };
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();if(!editor || busyRef.current)return;
    if(!editor.title.trim() && !editor.body.trim()){setMessage("Hãy thêm tiêu đề hoặc một vài dòng cho kỷ niệm.");return;}
    busyRef.current=true;setBusy(true);setMessage("");let saved=false;
    try {
      const result=await client.rpc("journal_save",{p_id:editor.id,p_expected:editor.revision,p_title:editor.title,p_body:editor.body,p_date:editor.date,p_visibility:editor.visibility});
      if(result.error || typeof result.data!=="number") {if(result.error?.code==="40001") throw new Error("Bài này đã thay đổi trên thiết bị khác. Hãy sao chép nội dung đang viết, đóng và mở lại bài mới nhất.");throw new Error("Chưa lưu được bài viết. Hãy kiểm tra kết nối và thử lại.");}
      saved=true;setEditor(current=>current ? {...current,revision:result.data as number}:current);
      for(const id of remove){const deletion=await client.rpc("journal_photo_delete",{p_photo:id});if(deletion.error)throw new Error("Bài đã lưu nhưng chưa xóa được một ảnh. Hãy thử lại.");setRemove(current=>current.filter(x=>x!==id));setEditor(current=>current ? {...current,photos:current.photos.filter(x=>x!==id)}:current);}
      for(const item of pendingRef.current){
        const image=await prepareJournalPhoto(item.file), token=await tokenFor(client);
        const response=await fetch("/api/journal-photo",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({entryId:editor.id,photoId:item.id,image})});
        if(response.status===409)throw new Error("Ảnh đang được xử lý. Hãy đợi một chút rồi thử lại.");
        if(!response.ok){pendingRef.current=pendingRef.current.map(p=>p.id===item.id ? {...p,id:crypto.randomUUID()} : p);setPending(pendingRef.current);throw new Error("Bài đã lưu nhưng chưa tải hết ảnh. Hãy thử lại.");}
        URL.revokeObjectURL(item.preview);pendingRef.current=pendingRef.current.filter(p=>p.id!==item.id);setPending(pendingRef.current);
        setEditor(current=>current ? {...current,photos:[...current.photos,item.id]}:current);
      }
      clearPending();setEditor(null);await load(true);void cleanup(client);
    } catch(err){setMessage(err instanceof Error ? err.message : saved ? "Bài đã lưu nhưng ảnh chưa tải xong. Hãy thử lại." : "Không thể lưu. Hãy thử lại.");}
    finally{busyRef.current=false;if(live.current)setBusy(false);}
  };
  const deleteEntry=async(entry:Memory)=>{
    if(!confirm("Xóa kỷ niệm này và các ảnh trong bài?"))return;
    busyRef.current=true;setBusy(true);setMessage("");
    try{const result=await client.rpc("journal_delete",{p_id:entry.id,p_expected:entry.revision});if(result.error)throw result.error;setDetail(null);await load(true);void cleanup(client);}
    catch{setMessage("Không xóa được kỷ niệm. Bài có thể đã thay đổi trên thiết bị khác.");}
    finally{busyRef.current=false;if(live.current)setBusy(false);}
  };
  const visible=items.filter(item=>filter==="all" || item.visibility===filter);
  const cards:JournalCardData[]=visible.map(item=>({...item,editable:item.ownerId===userId,authorName:item.ownerId===userId ? "Bạn" : item.authorName}));
  return <>
    <JournalView entries={cards} loading={loading} error={error} onCreate={startNew} onOpen={entry=>{setMessage("");setDetail(entry.id);}} onRetry={()=>{setLoading(true);void load(true);}} renderPhoto={(id,alt)=><MemoryPhoto client={client} id={id} alt={alt}/>} filtered={filter!=="all"} filters={!loading && !error && items.length>0 ? <div className="memories-filters" role="group" aria-label="Lọc kỷ niệm">{([["all","Tất cả"],["private","Riêng tư"],["family","Gia đình"]] as const).map(([value,label])=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div> : null} />
    {detail && selected && <div className="modal-backdrop memory-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget && !busy)setDetail(null);}}><article ref={detailDialog} className="modal memory-detail" role="dialog" aria-modal="true" aria-label="Chi tiết kỷ niệm">
      <div className="memory-dialog-top"><span>{selected.visibility==="private" ? <LockKeyhole size={15}/> : <UsersRound size={15}/>} {selected.visibility==="private" ? "Riêng tư" : "Chia sẻ với gia đình"}</span><button type="button" className="icon-btn" aria-label="Đóng" onClick={()=>setDetail(null)}><X size={20}/></button></div>
      <p className="memory-dialog-date">{selected.date.split("-").reverse().join("/")} · {selected.ownerId===userId ? "Bạn" : selected.authorName}</p><h2>{selected.title || "Một ngày đáng nhớ"}</h2><p className="memory-dialog-body">{selected.body}</p>
      {!!selected.photos.length && <div className="memory-detail-photos">{selected.photos.map((id,index)=><div className="memory-detail-photo" key={id}><MemoryPhoto client={client} id={id} alt={`Ảnh kỷ niệm ${index+1}`}/></div>)}</div>}
      {message && <p className="memory-error" role="alert">{message}</p>}
      {selected.ownerId===userId && <div className="memory-dialog-actions"><button type="button" className="outline-btn" disabled={busy} onClick={()=>startEdit(selected)}><Pencil size={16}/> Sửa bài</button><button type="button" className="outline-btn memory-delete" disabled={busy} onClick={()=>void deleteEntry(selected)}><Trash2 size={16}/> Xóa bài</button></div>}
    </article></div>}
    {editor && <div className="modal-backdrop memory-modal-backdrop"><form ref={editorDialog} className="modal memory-editor" onSubmit={submit} role="dialog" aria-modal="true" aria-label={editor.revision ? "Sửa kỷ niệm" : "Viết kỷ niệm"}>
      <div className="memory-editor-heading"><div><span className="memories-kicker">NHỮNG ĐIỀU THƯƠNG</span><h2>{editor.revision ? "Chỉnh sửa kỷ niệm" : "Viết một kỷ niệm"}</h2><p>Lưu lại điều bạn muốn nhớ.</p></div><button type="button" className="icon-btn" aria-label="Đóng" disabled={busy} onClick={closeEditor}><X size={20}/></button></div>
      <label>Tiêu đề<input maxLength={120} value={editor.title} disabled={busy} onChange={e=>setEditor({...editor,title:e.target.value})} placeholder="Ví dụ: Một ngày bên nhau"/></label>
      <label>Ngày kỷ niệm<input type="date" required value={editor.date} disabled={busy} onChange={e=>setEditor({...editor,date:e.target.value})}/></label>
      <label>Câu chuyện<textarea maxLength={10000} rows={5} value={editor.body} disabled={busy} onChange={e=>setEditor({...editor,body:e.target.value})} placeholder="Hôm ấy có chuyện gì vui?"/></label>
      <fieldset className="memory-privacy"><legend>Ai có thể xem?</legend><label><input type="radio" name="visibility" checked={editor.visibility==="private"} disabled={busy} onChange={()=>setEditor({...editor,visibility:"private"})}/><LockKeyhole size={16}/> Riêng tư</label><label><input type="radio" name="visibility" checked={editor.visibility==="family"} disabled={busy || family?.status!=="active"} onChange={()=>setEditor({...editor,visibility:"family"})}/><UsersRound size={16}/> Gia đình</label>{family?.status!=="active" && <small>Cần tham gia gia đình để chia sẻ.</small>}</fieldset>
      <div className="memory-photos-heading"><strong>Ảnh kỷ niệm</strong><span>Tối đa 8 ảnh · 10 MB/ảnh</span></div>
      <div className="memory-editor-photos">{editor.photos.filter(id=>!remove.includes(id)).map((id,index)=><div className="memory-editor-thumb" key={id}><MemoryPhoto client={client} id={id} alt={`Ảnh đã lưu ${index+1}`}/><button type="button" aria-label={`Xóa ảnh đã lưu ${index+1}`} disabled={busy} onClick={()=>setRemove([...remove,id])}><X size={15}/></button></div>)}{pending.map((item,index)=><div className="memory-editor-thumb" key={item.id}><Image src={item.preview} alt={`Ảnh mới ${index+1}`} fill unoptimized sizes="80px"/><button type="button" aria-label={`Bỏ ảnh mới ${index+1}`} disabled={busy} onClick={()=>{URL.revokeObjectURL(item.preview);setPending(pending.filter(p=>p.id!==item.id));}}><X size={15}/></button></div>)}<label className="memory-photo-add"><ImagePlus size={20} aria-hidden="true"/><span>Thêm ảnh</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={chooseFiles}/></label></div>
      {message && <p className="memory-error" role="alert">{message}</p>}
      <button className="primary-btn form-submit" type="submit" disabled={busy}>{busy ? "Đang lưu kỷ niệm…" : "Lưu kỷ niệm"}</button>
    </form></div>}
  </>;
}
