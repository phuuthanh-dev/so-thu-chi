"use client";
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Member = { userId: string; phone: string | null; role: "owner" | "member"; status: "active" | "pending" };
export type Family = { id: string; name: string; role: "owner" | "member"; status: "active" | "pending"; members: Member[] };
type Wallet = { id: string; name: string; archived?: boolean };
type Choice = { walletId: string; ownerId: string; visibility: "private" | "shared" };
const inviteKey = "nha-minh-family-invitation";

export function captureFamilyInvitation() {
  const match = /^#moi=([0-9a-f]{64})$/.exec(window.location.hash);
  if (match) {
    sessionStorage.setItem(inviteKey, match[1]);
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

export function FamilyManager({ client, userId, family, onFamily, personal, wallets, personalVersion, disabled, refresh, switchWorkspace }: {
  client: SupabaseClient; userId: string; family: Family | null; onFamily: (family: Family | null) => void;
  personal: boolean; wallets: Wallet[]; personalVersion: () => number | null; disabled: boolean; refresh: () => Promise<void>;
  switchWorkspace: (family: Family | null) => void;
}) {
  const [loading, setLoading] = useState(false), [message, setMessage] = useState("");
  const [name, setName] = useState("Nhà mình"), [link, setLink] = useState("");
  const [invitation, setInvitation] = useState("");
  const [choices, setChoices] = useState<Choice[]>([]);
  const load = useCallback(async () => {
    const { data, error } = await client.rpc("family_status");
    if (error) { setMessage("Không tải được thông tin gia đình. Vui lòng thử lại."); return; }
    onFamily(data as Family | null);
  }, [client, onFamily]);
  useEffect(() => { void Promise.resolve().then(() => { setInvitation(sessionStorage.getItem(inviteKey) || ""); void load(); }); }, [load]);
  async function run(action: () => Promise<void>) {
    setLoading(true); setMessage("");
    try { await action(); } catch { setMessage("Không thể thực hiện. Kiểm tra kết nối và thử lại."); } finally { setLoading(false); }
  }
  async function call(name: string, args?: Record<string, unknown>) {
    const result = await client.rpc(name, args);
    if (result.error) throw result.error;
    return result.data;
  }
  const active = family?.members.filter(member => member.status === "active") || [];
  return <section className="card full-card family-card">
    <h2>Gia đình &amp; ví chung</h2>
    <p>Ví riêng chỉ chủ sở hữu nhìn thấy. Thành viên có thể cùng thêm, sửa và xóa giao dịch trong ví chia sẻ.</p>
    <p className="soft-note">Số điện thoại trong ứng dụng chưa xác minh bằng SMS. Hãy xác nhận trực tiếp đúng người trước khi duyệt lời mời.</p>
    {message && <p role="status" className="soft-note">{message}</p>}
    {!family && <>
      {invitation && <div className="setting-row"><div><strong>Bạn có lời mời gia đình</strong><p>Gửi yêu cầu tham gia; chủ gia đình sẽ duyệt.</p></div><button className="outline-btn" disabled={loading} onClick={() => void run(async () => { await call("family_request_join", { invite_token: invitation }); sessionStorage.removeItem(inviteKey); setInvitation(""); await load(); setMessage("Đã gửi yêu cầu. Vui lòng chờ chủ gia đình duyệt."); })}>Gửi yêu cầu</button></div>}
      <form className="family-form" onSubmit={event => { event.preventDefault(); void run(async () => { await call("family_create", { family_name: name.trim() }); await load(); setMessage("Đã tạo gia đình."); }); }}><label>Tên gia đình<input value={name} maxLength={80} required onChange={e => setName(e.target.value)} /></label><button className="primary-btn" disabled={loading}>Tạo gia đình</button></form>
    </>}
    {family?.status === "pending" && <p>Yêu cầu tham gia <strong>{family.name}</strong> đang chờ duyệt. <button className="text-link" onClick={() => void load()}>Kiểm tra lại</button></p>}
    {family?.status === "active" && <>
      <div className="setting-row"><div><strong>{family.name}</strong><p>{personal ? "Bạn đang xem sổ cá nhân." : "Bạn đang xem những ví gia đình mà bạn được phép truy cập."}</p></div><button className="outline-btn" disabled={disabled} onClick={() => switchWorkspace(personal ? family : null)}>{personal ? "Mở sổ gia đình" : "Về sổ cá nhân"}</button></div>
      <h3>Thành viên</h3>
      {family.members.map(member => <div className="setting-row" key={member.userId}><div><strong>{member.userId === userId ? "Bạn" : member.phone || "Thành viên"}</strong><p>{member.status === "pending" ? "Đang chờ duyệt" : member.role === "owner" ? "Chủ gia đình" : "Thành viên"}</p></div>{member.status === "pending" && family.role === "owner" && <div className="family-actions"><button className="outline-btn" disabled={loading} onClick={() => void run(async () => { await call("family_respond_member", { member_id: member.userId, approve: true }); await load(); })}>Duyệt</button><button className="outline-btn" disabled={loading} onClick={() => void run(async () => { await call("family_respond_member", { member_id: member.userId, approve: false }); await load(); })}>Từ chối</button></div>}{member.status === "active" && member.role === "member" && family.role === "owner" && <button className="outline-btn" disabled={loading} onClick={() => { if (!confirm("Xóa thành viên khỏi gia đình? Người này sẽ mất quyền xem các ví chia sẻ. Nếu họ đang sở hữu ví, cần chuyển quyền sở hữu trước.")) return; void run(async () => { const result = await client.rpc("family_remove_member", { member_id: member.userId }); if (result.error) { setMessage(result.error.code === "23514" ? "Thành viên đang sở hữu ví. Hãy nhờ họ chuyển quyền sở hữu tất cả ví trước." : "Không thể xóa thành viên. Vui lòng thử lại."); return; } await load(); setMessage("Đã xóa thành viên khỏi gia đình."); }); }}>Xóa thành viên</button>}</div>)}
      {family.role === "owner" && <div className="setting-row"><div><strong>Mời thành viên</strong><p>Liên kết dùng một lần, hết hạn sau 24 giờ. Chỉ gửi riêng cho người bạn muốn mời.</p>{link && <input aria-label="Liên kết mời" readOnly value={link} onFocus={e => e.currentTarget.select()} />}</div><button className="outline-btn" disabled={loading} onClick={() => void run(async () => { const token = await call("family_create_invite"); const next = `${location.origin}/#moi=${token}`; setLink(next); try { await navigator.clipboard.writeText(next); setMessage("Đã sao chép liên kết mời."); } catch { setMessage("Hãy sao chép liên kết bên dưới."); } })}>Tạo liên kết mời</button></div>}
      {personal && <div className="family-transfer"><h3>Chuyển ví cá nhân vào gia đình</h3><p>Chọn từng ví, chủ sở hữu và quyền xem. Giao dịch và lịch định kỳ của ví sẽ được chuyển theo; ví sẽ không còn trong sổ cá nhân. Ví riêng của người khác sẽ không còn hiện với bạn.</p>
        {wallets.map(w => { const choice = choices.find(c => c.walletId === w.id); return <div className="family-wallet-choice" key={w.id}><label><input type="checkbox" checked={!!choice} onChange={e => setChoices(e.target.checked ? [...choices, {walletId:w.id, ownerId:userId, visibility:"private"}] : choices.filter(c => c.walletId !== w.id))} /> {w.name}{w.archived ? " (đã lưu trữ)" : ""}</label>{choice && <><label>Chủ sở hữu<select value={choice.ownerId} onChange={e => setChoices(choices.map(c => c.walletId === w.id ? {...c, ownerId:e.target.value} : c))}>{active.map(m => <option key={m.userId} value={m.userId}>{m.userId === userId ? "Tôi" : m.phone || "Thành viên"}</option>)}</select></label><label>Quyền xem<select value={choice.visibility} onChange={e => setChoices(choices.map(c => c.walletId === w.id ? {...c, visibility:e.target.value as Choice["visibility"]} : c))}><option value="private">Riêng tư</option><option value="shared">Chia sẻ với gia đình</option></select></label></>}</div>; })}
        <button className="primary-btn" disabled={!choices.length || disabled || loading} onClick={() => { if (!confirm(`Chuyển ${choices.length} ví đã chọn và toàn bộ giao dịch, lịch định kỳ sang gia đình? Hãy kiểm tra kỹ chủ sở hữu và quyền xem.`)) return; void run(async () => { const result = await call("family_open_ledger"); if (!result?.[0] || personalVersion() === null) throw new Error("Missing version"); await call("family_transfer_wallets", { expected_personal_version:personalVersion(), expected_family_version:result[0].version, choices }); setChoices([]); await refresh(); setMessage("Đã chuyển các ví đã chọn."); }); }}>Chuyển ví đã chọn</button>
      </div>}
      <p className="footnote">Danh mục và ngân sách trong sổ gia đình là thiết lập riêng của từng thành viên; báo cáo chỉ tính các ví bạn được xem.</p>
    </>}
  </section>;
}
