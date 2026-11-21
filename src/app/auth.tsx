"use client";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { brandLogoDisplay } from "@/lib/branding";

export function AuthGate({ children }: { children: (client: SupabaseClient, user: User) => React.ReactNode }) {
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    return url && key ? createClient(url, key) : null;
  }, []);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!client) return;
    let active = true;
    client.auth.getSession().then(({ data }) => { if (active) { setUser(data.session?.user ?? null); setReady(true); } });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => { if (active) { setUser(session?.user ?? null); setReady(true); } });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [client]);

  if (!client) return <main className="auth-screen"><section className="auth-card"><h1>Chưa kết nối dữ liệu</h1><p>Ứng dụng cần được cấu hình Supabase trước khi có thể đăng nhập. Vui lòng xem hướng dẫn thiết lập trong README.</p></section></main>;
  if (!ready) return <main className="loading">Đang kiểm tra phiên đăng nhập...</main>;
  if (user) return children(client, user);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage("");
    const trimmed = phone.replace(/[\s().-]/g, "");
    const normalized = /^0\d{9}$/.test(trimmed) ? `+84${trimmed.slice(1)}` : trimmed;
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) { setMessage("Nhập số điện thoại Việt Nam hoặc số quốc tế có mã quốc gia, ví dụ +84901234567."); return; }
    if (signup && password.length < 10) { setMessage("Mật khẩu cần ít nhất 10 ký tự."); return; }
    setBusy(true);
    try {
      const result = signup ? await client.auth.signUp({ phone: normalized, password }) : await client.auth.signInWithPassword({ phone: normalized, password });
      if (result.error) setMessage(signup ? "Không thể tạo tài khoản. Kiểm tra cấu hình đăng ký hoặc thử số điện thoại khác." : "Không thể đăng nhập. Kiểm tra số điện thoại và mật khẩu.");
      else if (!result.data.session) setMessage("Tài khoản chưa thể đăng nhập. Hãy kiểm tra cấu hình xác nhận số điện thoại của dịch vụ.");
      else setPassword("");
    } catch { setMessage("Không thể kết nối. Vui lòng thử lại."); }
    finally { setBusy(false); }
  };
  return <main className="auth-screen"><section className="auth-card"><div className="brand"><div className="brand-mark"><Image src={brandLogoDisplay} alt="" width={38} height={38} unoptimized/></div><div><strong>nhà mình<span>.</span></strong><small>SỔ THU CHI</small></div></div><div className="eyebrow">MỘT KHÔNG GIAN CỦA RIÊNG BẠN</div><h1>{signup ? "Tạo tài khoản" : "Chào mừng trở lại"}</h1><p>Đăng nhập để lưu sổ thu chi và xem trên nhiều thiết bị.</p><form onSubmit={submit}><label>Số điện thoại<input type="tel" autoComplete="tel" required placeholder="090 123 4567" value={phone} onChange={e=>setPhone(e.target.value)}/></label><label>Mật khẩu<input type="password" autoComplete={signup?"new-password":"current-password"} required minLength={signup?10:1} value={password} onChange={e=>setPassword(e.target.value)}/></label>{signup&&<p className="auth-hint">Tối thiểu 10 ký tự. Hiện chưa hỗ trợ khôi phục mật khẩu tự động; hãy lưu mật khẩu an toàn.</p>}{message&&<p className="auth-error" role="alert">{message}</p>}<button className="primary-btn form-submit" disabled={busy}>{busy ? "Đang xử lý..." : signup ? "Tạo tài khoản" : "Đăng nhập"}</button></form><p className="auth-switch">{signup?"Đã có tài khoản?":"Chưa có tài khoản?"} <button onClick={()=>{setSignup(!signup);setMessage("")}}>{signup?"Đăng nhập":"Đăng ký"}</button></p></section></main>;
}
