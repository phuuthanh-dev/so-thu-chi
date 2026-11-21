"use client";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TransferWallet = { ref: string; walletId: string; name: string; ownerId: string };
export type TransferLeg = { id: string; ref: string; walletId: string; direction: "in" | "out"; amount: number; date: string; createdAt: string; otherName: string };
export type TransferState = { wallets: TransferWallet[]; legs: TransferLeg[] };
export function transferDelta(legs: TransferLeg[], ref: string): number {
  return legs.filter(leg => leg.ref === ref).reduce((sum, leg) => sum + (leg.direction === "in" ? leg.amount : -leg.amount), 0);
}
export function TransferForm({client, userId, wallets, onDone, onCancel}: {client: SupabaseClient; userId: string; wallets: TransferWallet[]; onDone: () => Promise<void>; onCancel: () => void}) {
  const pendingKey = `nha-minh-pending-transfer:${userId}`;
  type Pending = {id: string; source: string; destination: string; amount: number};
  const [source,setSource]=useState(wallets[0]?.ref || "");
  const [destination,setDestination]=useState(wallets[1]?.ref || "");
  const [amount,setAmount]=useState("");
  const [pending,setPending]=useState<Pending | null>(null);
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(false);
  const [ready,setReady]=useState(false);
  const busy=useRef(false);
  useEffect(()=>{ void Promise.resolve().then(() => {
    try {
      const stored = localStorage.getItem(pendingKey);
      if (stored) {
        const value = JSON.parse(stored) as Pending;
        if (typeof value.id === "string" && typeof value.source === "string" && typeof value.destination === "string" && Number.isSafeInteger(value.amount) && value.amount > 0) {
          setPending(value); setSource(value.source); setDestination(value.destination); setAmount(String(value.amount));
          setMessage("Lần chuyển trước chưa được xác nhận. Hãy nhấn Kiểm tra lại để tránh ghi trùng.");
        }
      }
    } catch { setMessage("Không đọc được thông tin chuyển tiền đang chờ xác nhận."); }
    setReady(true);
  }); },[pendingKey]);
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault(); if(busy.current) return;
    const value=Number(amount);
    if (!pending && (!source || !destination || source === destination || !Number.isSafeInteger(value) || value<=0)) { setMessage("Chọn hai ví khác nhau và nhập số tiền lớn hơn 0."); return; }
    const attempt=pending || {id:crypto.randomUUID(),source,destination,amount:value};
    try { localStorage.setItem(pendingKey,JSON.stringify(attempt)); }
    catch { setMessage("Không thể lưu trạng thái xác nhận trên thiết bị. Hãy kiểm tra bộ nhớ trình duyệt."); return; }
    setPending(attempt); busy.current=true; setLoading(true); setMessage("");
    try {
      const result=await client.rpc("wallet_transfer_create",{p_id:attempt.id,p_source:attempt.source,p_destination:attempt.destination,p_amount:attempt.amount});
      if (result.error) {
        // A definitive validation/permission error means the transfer was not committed.
        if (["22023","42501","23505"].includes(result.error.code || "")) {
          localStorage.removeItem(pendingKey); setPending(null); setMessage("Không thể chuyển: ví không còn khả dụng hoặc dữ liệu không hợp lệ. Hãy tải lại và thử lại.");
        } else setMessage("Chưa xác nhận được kết quả. Hãy nhấn Kiểm tra lại; ứng dụng sẽ không ghi trùng.");
        return;
      }
      localStorage.removeItem(pendingKey); setPending(null); await onDone();
    } catch { setMessage("Chưa xác nhận được kết quả. Hãy nhấn Kiểm tra lại; ứng dụng sẽ không ghi trùng."); }
    finally {busy.current=false;setLoading(false);}
  };
  return <form onSubmit={submit}>
    <p className="modal-desc">Chuyển giữa các ví bạn có quyền sử dụng. Khoản chuyển không tính vào thu nhập, chi tiêu hay ngân sách.</p>
    <label>Từ ví<select value={source} onChange={e=>setSource(e.target.value)} disabled={!!pending || loading} required>{wallets.map(w=><option key={w.ref} value={w.ref}>{w.name} {w.ref.startsWith("p:") ? "· Cá nhân" : w.ownerId === userId ? "· Ví của bạn" : "· Ví gia đình"}</option>)}</select></label>
    <label>Đến ví<select value={destination} onChange={e=>setDestination(e.target.value)} disabled={!!pending || loading} required>{wallets.map(w=><option key={w.ref} value={w.ref}>{w.name} {w.ref.startsWith("p:") ? "· Cá nhân" : w.ownerId === userId ? "· Ví của bạn" : "· Ví gia đình"}</option>)}</select></label>
    <label>Số tiền (₫)<input type="number" inputMode="numeric" min="1" step="1" max="9007199254740991" value={amount} onChange={e=>setAmount(e.target.value)} disabled={!!pending || loading} required /></label>
    {message && <p className="avatar-error" role="alert">{message}</p>}
    <button className="primary-btn form-submit" disabled={!ready || loading || (!pending && wallets.length<2)}>{loading ? "Đang xác nhận..." : pending ? "Kiểm tra lại" : "Chuyển tiền"}</button>
    <button type="button" className="outline-btn form-submit" disabled={loading} onClick={onCancel}>Đóng</button>
  </form>;
}
