"use client";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { moneyInput, parseMoney, walletCurrency, type Currency } from "@/lib/currency";

export type TransferWallet = { ref: string; walletId: string; name: string; ownerId: string; currency?: Currency; ownerLabel?: string };
export type TransferLeg = { id: string; ref: string; walletId: string; direction: "in" | "out"; amount: number; currency?: Currency; date: string; createdAt: string; otherName: string };
export type TransferState = { wallets: TransferWallet[]; legs: TransferLeg[] };
export function transferDelta(legs: TransferLeg[], ref: string): number {
  return legs.filter(leg => leg.ref === ref).reduce((sum, leg) => sum + (leg.direction === "in" ? leg.amount : -leg.amount), 0);
}
export function TransferForm({client, userId, wallets, familyMode=false, onDone, onCancel}: {client: SupabaseClient; userId: string; wallets: TransferWallet[]; familyMode?: boolean; onDone: () => Promise<void>; onCancel: () => void}) {
  const pendingKey = `nha-minh-pending-transfer:${userId}`;
  type Pending = {id: string; source: string; destination: string; amount: number; destinationAmount?: number};
  const [source,setSource]=useState(wallets[0]?.ref || "");
  const [destination,setDestination]=useState(wallets[1]?.ref || "");
  const [amount,setAmount]=useState("");
  const [received,setReceived]=useState("");
  const [pending,setPending]=useState<Pending | null>(null);
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(false);
  const [ready,setReady]=useState(false);
  const busy=useRef(false);
  const sourceCurrency=walletCurrency(wallets.find(w=>w.ref===source)?.currency);
  const destinationCurrency=walletCurrency(wallets.find(w=>w.ref===destination)?.currency);
  const crossCurrency=sourceCurrency!==destinationCurrency;
  useEffect(()=>{ void Promise.resolve().then(() => {
    try {
      const stored = localStorage.getItem(pendingKey);
      if (stored) {
        const value = JSON.parse(stored) as Pending;
        if (typeof value.id === "string" && typeof value.source === "string" && typeof value.destination === "string" && Number.isSafeInteger(value.amount) && value.amount > 0 && (value.destinationAmount === undefined || (Number.isSafeInteger(value.destinationAmount) && value.destinationAmount > 0))) {
          setPending(value); setSource(value.source); setDestination(value.destination);
          setAmount(moneyInput(value.amount,walletCurrency(wallets.find(w=>w.ref===value.source)?.currency)));
          setReceived(moneyInput(value.destinationAmount ?? value.amount,walletCurrency(wallets.find(w=>w.ref===value.destination)?.currency)));
          setMessage("Lần chuyển trước chưa được xác nhận. Hãy nhấn Kiểm tra lại để tránh ghi trùng.");
        }
      }
    } catch { setMessage("Không đọc được thông tin chuyển tiền đang chờ xác nhận."); }
    setReady(true);
  }); },[pendingKey, wallets]);
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault(); if(busy.current) return;
    const value=parseMoney(amount,sourceCurrency);
    const receivedValue=crossCurrency ? parseMoney(received,destinationCurrency) : value;
    if (!pending && (!source || !destination || source === destination || value === null || value<=0 || receivedValue === null || receivedValue<=0)) { setMessage("Chọn hai ví khác nhau và nhập số tiền hợp lệ lớn hơn 0."); return; }
    const attempt=pending || {id:crypto.randomUUID(),source,destination,amount:value!,destinationAmount:receivedValue!};
    try { localStorage.setItem(pendingKey,JSON.stringify(attempt)); }
    catch { setMessage("Không thể lưu trạng thái xác nhận trên thiết bị. Hãy kiểm tra bộ nhớ trình duyệt."); return; }
    setPending(attempt); busy.current=true; setLoading(true); setMessage("");
    try {
      const result=await client.rpc("wallet_transfer_create_v3",{p_id:attempt.id,p_source:attempt.source,p_destination:attempt.destination,p_amount:attempt.amount,p_destination_amount:attempt.destinationAmount ?? attempt.amount});
      if (result.error) {
        if (["22023","42501","23505"].includes(result.error.code || "")) {
          localStorage.removeItem(pendingKey); setPending(null); setMessage("Không thể chuyển: ví không còn khả dụng hoặc dữ liệu không hợp lệ. Hãy tải lại và thử lại.");
        } else setMessage("Chưa xác nhận được kết quả. Hãy nhấn Kiểm tra lại; ứng dụng sẽ không ghi trùng.");
        return;
      }
      localStorage.removeItem(pendingKey); setPending(null); await onDone();
    } catch { setMessage("Chưa xác nhận được kết quả. Hãy nhấn Kiểm tra lại; ứng dụng sẽ không ghi trùng."); }
    finally {busy.current=false;setLoading(false);}
  };
  const options=(selected:string)=><>{selected && !wallets.some(w=>w.ref===selected) && <option value={selected}>Ví không còn khả dụng</option>}{wallets.map(w=><option key={w.ref} value={w.ref}>{w.name} · {walletCurrency(w.currency)}{familyMode ? ` · ${w.ref.startsWith("f:") ? w.ownerLabel || "Thành viên" : "Cá nhân"}` : ""}</option>)}</>;
  const walletHint=(ref:string,id:string)=>{const w=wallets.find(item=>item.ref===ref);return familyMode && w ? <small id={id} className="transfer-wallet-hint">{w.ref.startsWith("f:") ? `Ví gia đình · Chủ: ${w.ownerLabel || "Thành viên"}` : "Ví cá nhân của bạn"}</small> : null;};
  return <form className="transfer-form" onSubmit={submit}>
    <p className="modal-desc">{familyMode ? "Chuyển giữa ví của bạn và ví gia đình bạn được sử dụng." : "Chuyển giữa các ví bạn sở hữu."} Khoản chuyển không tính vào thu nhập, chi tiêu hay ngân sách.</p>
    <label>Từ ví<select aria-label="Từ ví" aria-describedby={familyMode && wallets.some(w=>w.ref===source) ? "transfer-source-hint" : undefined} value={source} onChange={e=>{setSource(e.target.value);setAmount("");setReceived("");}} disabled={!!pending || loading} required>{options(source)}</select>{walletHint(source,"transfer-source-hint")}</label>
    <label>Đến ví<select aria-label="Đến ví" aria-describedby={familyMode && wallets.some(w=>w.ref===destination) ? "transfer-destination-hint" : undefined} value={destination} onChange={e=>{setDestination(e.target.value);setReceived("");}} disabled={!!pending || loading} required>{options(destination)}</select>{walletHint(destination,"transfer-destination-hint")}</label>
    <label>Số tiền gửi ({sourceCurrency})<input type="text" inputMode={sourceCurrency === "USD" ? "decimal" : "numeric"} value={amount} onChange={e=>setAmount(e.target.value)} disabled={!!pending || loading} required /></label>
    {crossCurrency && <><label>Số tiền thực nhận ({destinationCurrency})<input type="text" inputMode={destinationCurrency === "USD" ? "decimal" : "numeric"} value={received} onChange={e=>setReceived(e.target.value)} disabled={!!pending || loading} required /></label><p className="modal-desc">Nhập số thực nhận sau quy đổi và phí; ứng dụng không tự tính tỷ giá.</p></>}
    {message && <p className="avatar-error" role="alert">{message}</p>}
    <button className="primary-btn form-submit" disabled={!ready || loading || (!pending && wallets.length<2)}>{loading ? "Đang xác nhận..." : pending ? "Kiểm tra lại" : "Chuyển tiền"}</button>
    <button type="button" className="outline-btn form-submit" disabled={loading} onClick={onCancel}>Đóng</button>
  </form>;
}
