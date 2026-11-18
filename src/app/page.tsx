"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { prepareAvatar, validateAvatarFile, type AvatarCrop } from "@/lib/avatar";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { PetalFall } from "./petals";
import { AvatarEditor } from "./avatar-editor";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { AuthGate } from "./auth";
import {
  budgetPercent,
  calculateWalletBalance,
  equalJson,
  listDrafts,
  removeDraft,
  visibleBreakdown,
  writeDraft,
  type Draft,
} from "@/lib/ledger";
import {
  ArrowDownLeft,
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  LayoutGrid,
  Menu,
  MoreHorizontal,
  Plus,
  Repeat2,
  Search,
  Settings,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";

type Kind = "expense" | "income";
type Entry = {
  id: string;
  type: Kind;
  amount: number;
  date: string;
  category: string;
  note: string;
  wallet: string;
  origin?: string;
};
type WalletItem = { id: string; name: string; balance: number; archived?: boolean };
type Rule = {
  id: string;
  type: Kind;
  amount: number;
  category: string;
  note: string;
  wallet: string;
  next: string;
  active: boolean;
  anchorDay?: number;
};
type Data = {
  entries: Entry[];
  wallets: WalletItem[];
  budgets: Record<string, number>;
  rules: Rule[];
  categories: Record<Kind, string[]>;
  avatar?: string | null;
};
const dateISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const money = (n: number) => new Intl.NumberFormat("vi-VN").format(n) + "\u00a0₫";
const uid = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const nextMonth = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  const mo = m === 12 ? 1 : m + 1,
    yr = m === 12 ? y + 1 : y;
  return `${yr}-${String(mo).padStart(2, "0")}-${String(Math.min(d, new Date(yr, mo, 0).getDate())).padStart(2, "0")}`;
};
const monthLabel = (m: string) =>
  `Tháng ${Number(m.slice(5))}, ${m.slice(0, 4)}`;
const colors: Record<string, string> = {
  "Ăn uống": "#e4a184",
  "Mua sắm": "#ce9cc4",
  "Đi lại": "#90b2c5",
  "Nhà cửa": "#d2b789",
  "Sức khỏe": "#e69b9a",
  "Giải trí": "#b6a8d5",
  Lương: "#8bac91",
  "Thu nhập khác": "#90b8a6",
};
const symbols: Record<string, string> = {
  "Ăn uống": "◒",
  "Mua sắm": "✿",
  "Đi lại": "↗",
  "Nhà cửa": "⌂",
  "Sức khỏe": "✚",
  "Giải trí": "✦",
  Lương: "↙",
  "Thu nhập khác": "✳",
};
const nav = [
  { id: "overview", label: "Tổng quan", Icon: LayoutGrid },
  { id: "transactions", label: "Giao dịch", Icon: ArrowDownLeft },
  { id: "wallets", label: "Ví của tôi", Icon: Wallet },
  { id: "reports", label: "Báo cáo", Icon: TrendingUp },
  { id: "budget", label: "Ngân sách", Icon: Target },
  { id: "recurring", label: "Định kỳ", Icon: Repeat2 },
];

gsap.registerPlugin(useGSAP);

export default function Page() {
  const [motionEnabled, setMotionEnabled] = useState(false);
  useEffect(() => {
    Promise.resolve().then(() => {
      try { setMotionEnabled(localStorage.getItem("nha-minh-motion") !== "off"); }
      catch { setMotionEnabled(true); }
    });
  }, []);
  const toggleMotion = () => {
    const next = !motionEnabled;
    try { localStorage.setItem("nha-minh-motion", next ? "on" : "off"); } catch { /* Setting still applies for this session. */ }
    setMotionEnabled(next);
  };
  return (
    <AuthGate>
      {(client, user) => <Ledger key={user.id} client={client} user={user} motionEnabled={motionEnabled} toggleMotion={toggleMotion} />}
    </AuthGate>
  );
}

function Ledger({ client, user, motionEnabled, toggleMotion }: { client: SupabaseClient; user: User; motionEnabled: boolean; toggleMotion: () => void }) {
  const [data, setData] = useState<Data | null>(null),
    [tab, setTab] = useState("overview"),
    [month, setMonth] = useState(""),
    [modal, setModal] = useState<
      "entry" | "wallet" | "budget" | "category" | "rule" | "avatar" | null
    >(null),
    [kind, setKind] = useState<Kind>("expense"),
    [amount, setAmount] = useState(""),
    [showAmountSuggestions, setShowAmountSuggestions] = useState(false),
    [date, setDate] = useState(""),
    [category, setCategory] = useState("Ăn uống"),
    [note, setNote] = useState(""),
    [wallet, setWallet] = useState("cash"),
    [repeat, setRepeat] = useState(false),
    [walletName, setWalletName] = useState(""),
    [walletBalance, setWalletBalance] = useState("0"),
    [walletEditId, setWalletEditId] = useState<string | null>(null),
    [budgetInput, setBudgetInput] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [menu, setMenu] = useState(false),
    [editId, setEditId] = useState<string | null>(null),
    [newCategory, setNewCategory] = useState(""),
    [ruleId, setRuleId] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarBackdropRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useGSAP(() => {
    if (!data || !motionEnabled || typeof window.matchMedia !== "function") return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(".page-heading", { y: 8, autoAlpha: 0, duration: 0.35, ease: "power2.out" });
    }, mainRef);
    return () => media.revert();
  }, { scope: mainRef, dependencies: [tab, !!data, motionEnabled], revertOnUpdate: true });
  const { contextSafe: sidebarContextSafe } = useGSAP(() => {
    if (!menu || !motionEnabled || !sidebarRef.current || typeof window.matchMedia !== "function") return;
    const media = gsap.matchMedia();
    media.add("(max-width: 760px) and (prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(sidebarRef.current, { xPercent: -100 }, { xPercent: 0, duration: 0.28, ease: "power2.out", clearProps: "transform" });
      gsap.fromTo(sidebarBackdropRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 });
    });
    return () => media.revert();
  }, { dependencies: [menu, motionEnabled], revertOnUpdate: true });
  const closeSidebar = () => sidebarContextSafe(() => {
    if (!motionEnabled || typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 760px) and (prefers-reduced-motion: no-preference)").matches || !sidebarRef.current || !sidebarBackdropRef.current) {
      setMenu(false);
      return;
    }
    gsap.to(sidebarRef.current, { xPercent: -100, duration: 0.24, ease: "power2.in", overwrite: true });
    gsap.to(sidebarBackdropRef.current, { autoAlpha: 0, duration: 0.24, overwrite: true, onComplete: () => setMenu(false) });
  })();
  useEffect(() => {
    if (!menu) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !modal) setMenu(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menu, modal]);
  const version = useRef<number | null>(null),
    busyRef = useRef(false),
    dirtyRef = useRef(false),
    activeDraftId = useRef<string | null>(null),
    modalRef = useRef(modal);
  useEffect(() => {
    modalRef.current = modal;
  }, [modal]);
  const [busy, setBusy] = useState(false),
    [syncError, setSyncError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [recurringError, setRecurringError] = useState(""),
    [drafts, setDrafts] = useState<Draft<Data>[]>([]);
  const updateDrafts = useCallback(() => {
    try {
      setDrafts(listDrafts<Data>(localStorage, user.id));
    } catch {
      setSyncError("Không đọc được bản nháp trên thiết bị này.");
    }
  }, [user.id]);
  const refresh = useCallback(
    async (force = false) => {
      if (!force && (busyRef.current || dirtyRef.current || modalRef.current))
        return;
      const previousVersion = version.current;
      try {
        const { data: rows, error } = await client.rpc("open_ledger");
        if (error || !rows?.[0]) throw error || new Error("No ledger");
        if (
          !force &&
          (busyRef.current ||
            dirtyRef.current ||
            modalRef.current ||
            version.current !== previousVersion)
        )
          return;
        version.current = Number(rows[0].version);
        setData(rows[0].data as Data);
        setLoadError("");
        if (force) {
          dirtyRef.current = false;
          activeDraftId.current = null;
          setSyncError("");
        }
        const status = await client.rpc("recurring_status");
        if (status.error) {
          setRecurringError(
            "Không kiểm tra được trạng thái giao dịch định kỳ. Hãy thử lại khi có kết nối.",
          );
        } else {
          setRecurringError(
            status.data?.length
              ? "Có lỗi khi ghi giao dịch định kỳ. Hệ thống sẽ thử lại; hãy kiểm tra kích thước sổ và liên hệ người quản trị nếu lỗi tiếp diễn."
              : "",
          );
        }
      } catch {
        setLoadError(
          "Không tải được dữ liệu. Hãy kiểm tra kết nối và cấu hình cơ sở dữ liệu.",
        );
      }
    },
    [client],
  );
  useEffect(() => {
    Promise.resolve().then(() => {
      const today = dateISO();
      setMonth(today.slice(0, 7));
      setDate(today);
      updateDrafts();
      void refresh(true);
    });
    const timer = window.setInterval(() => void refresh(), 20000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, updateDrafts]);
  const save = (d: Data) => {
    if (busyRef.current || version.current === null) return false;
    const draftId = activeDraftId.current || uid();
    try {
      writeDraft(localStorage, user.id, draftId, version.current, d);
      activeDraftId.current = draftId;
      updateDrafts();
    } catch {
      alert(
        "Không thể giữ bản nháp trên thiết bị. Vui lòng kiểm tra dung lượng hoặc quyền lưu trữ của trình duyệt trước khi lưu.",
      );
      return false;
    }
    busyRef.current = true;
    dirtyRef.current = true;
    setBusy(true);
    setData(d);
    setSyncError("");
    void (async () => {
      try {
        const { data: savedRows, error } = await client.rpc("save_ledger", {
          expected_version: version.current,
          new_data: d,
        });
        let rows = savedRows;
        if (error) throw error;
        if (!rows?.[0]) {
          // The previous write may have succeeded even though its response was lost.
          const latest = await client.rpc("open_ledger");
          if (
            latest.error ||
            !latest.data?.[0] ||
            !equalJson(latest.data[0].data, d)
          ) {
            setSyncError(
              "Chưa lưu: dữ liệu đã thay đổi trên thiết bị khác. Bản nháp được giữ trên thiết bị. Hãy tải dữ liệu mới và nhập lại thay đổi cần giữ.",
            );
            return;
          }
          rows = latest.data;
        }
        version.current = Number(rows[0].version);
        setData(rows[0].data as Data);
        dirtyRef.current = false;
        activeDraftId.current = null;
        try {
          removeDraft(
            localStorage,
            user.id,
            `nha-minh-draft-v1:${user.id}:${draftId}`,
          );
          updateDrafts();
        } catch {
          setSyncError(
            "Đã lưu lên máy chủ nhưng chưa thể xóa bản nháp cục bộ; có thể xóa sau trong danh sách bản nháp.",
          );
        }
        setLoadError("");
      } catch (error) {
        setSyncError(
          ["23514", "22023"].includes((error as { code?: string })?.code || "")
            ? "Chưa lưu: sổ có thể đã vượt giới hạn 2 MB. Bản nháp vẫn được giữ trên thiết bị; vui lòng liên hệ quản trị."
            : "Chưa lưu được dữ liệu. Bản nháp được giữ trên thiết bị; kiểm tra kết nối và thử lưu lại.",
        );
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
    return true;
  };
  const entries = useMemo(
    () =>
      data?.entries
        .filter((e) => e.date.startsWith(month))
        .sort((a, b) => b.date.localeCompare(a.date)) || [],
    [data, month],
  );
  const income = entries
      .filter((e) => e.type === "income")
      .reduce((s, e) => s + e.amount, 0),
    expense = entries
      .filter((e) => e.type === "expense")
      .reduce((s, e) => s + e.amount, 0),
    budget = data?.budgets[month] || 0;
  const breakdown = useMemo(() => {
    const result: Record<string, number> = {};
    entries
      .filter((e) => e.type === "expense")
      .forEach(
        (e) => (result[e.category] = (result[e.category] || 0) + e.amount),
      );
    return Object.entries(result).sort((a, b) => b[1] - a[1]);
  }, [entries]);
  const changeMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number),
      d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const openEntry = (t: Kind = "expense", e?: Entry) => {
    setKind(e?.type || t);
    setAmount(e ? String(e.amount) : "");
    setShowAmountSuggestions(false);
    setDate(e?.date || dateISO());
    setCategory(e?.category || data?.categories[t][0] || "Khác");
    setNote(e?.note || "");
    setWallet(e?.wallet || data?.wallets.find((item) => !item.archived)?.id || "");
    setRepeat(false);
    setEditId(e?.id || null);
    setModal("entry");
  };
  const submitEntry = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!data || !Number(amount) || !wallet) return;
    if (modal === "rule") {
      const existing = data.rules.find((item) => item.id === ruleId);
      if (!existing) return;
      const updated = {
        ...existing,
        type: kind,
        amount: Number(amount),
        category,
        note: note.trim(),
        wallet,
        next: date,
        anchorDay:
          date === existing.next ? existing.anchorDay : Number(date.slice(-2)),
      };
      if (
        save({
          ...data,
          rules: data.rules.map((item) =>
            item.id === ruleId ? updated : item,
          ),
        })
      )
        setModal(null);
      return;
    }
    const e: Entry = {
      id: editId || uid(),
      type: kind,
      amount: Number(amount),
      date,
      category,
      note: note.trim(),
      wallet,
    };
    const d = {
      ...data,
      entries: editId
        ? data.entries.map((x) =>
            x.id === editId ? { ...e, origin: x.origin } : x,
          )
        : [e, ...data.entries],
    };
    if (repeat && !editId)
      d.rules = [
        ...data.rules,
        {
          id: uid(),
          type: kind,
          amount: Number(amount),
          category,
          note: note.trim(),
          wallet,
          next: nextMonth(date),
          anchorDay: Number(date.slice(-2)),
          active: true,
        },
      ];
    if (save(d)) setModal(null);
  };
  if (!data)
    return (
      <main className="loading">
        {loadError || "Đang chuẩn bị sổ thu chi..."}
        {loadError && (
          <button onClick={() => void refresh(true)}>Thử lại</button>
        )}
      </main>
    );
  const avatar = data.avatar && /^data:image\/(webp|jpeg);base64,/.test(data.avatar) ? data.avatar : null;
  const renderAvatar = () => avatar ? <Image src={avatar} alt="" width={40} height={40} unoptimized /> : "M";
  const closeModal = () => { setModal(null); setAvatarFile(null); setAvatarError(""); };
  const changeAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || busyRef.current) return;
    setAvatarError("");
    try {
      validateAvatarFile(file);
      setAvatarFile(file);
      setModal("avatar");
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Không thể mở ảnh, vui lòng thử lại.");
    }
  };
  const saveAvatar = async (crop: AvatarCrop) => {
    if (!avatarFile || busyRef.current) return;
    setAvatarError("");
    busyRef.current = true;
    setBusy(true);
    try {
      const image = await prepareAvatar(avatarFile, crop);
      if (!mountedRef.current) return;
      busyRef.current = false;
      if (save({ ...data, avatar: image })) closeModal();
      else setBusy(false);
    } catch (error) {
      if (!mountedRef.current) return;
      busyRef.current = false;
      setBusy(false);
      setAvatarError(error instanceof Error ? error.message : "Không thể xử lý ảnh, vui lòng thử lại.");
    }
  };
  const list = entries.filter(
    (e) =>
      (filter === "all" || e.type === filter) &&
      `${e.note} ${e.category}`.toLowerCase().includes(query.toLowerCase()),
  );
  const ratio = budgetPercent(expense, budget);
  const renderTransactionList = (items: Entry[]) => (
    <div className="transaction-list">
      {items.length ? (
        items.map((e) => (
          <div className="transaction-row" key={e.id}>
            <span
              className="category-icon"
              style={{
                background: `${colors[e.category] || "#a5aaa4"}30`,
                color: colors[e.category] || "#a5aaa4",
              }}
            >
              {symbols[e.category] || "•"}
            </span>
            <button
              className="transaction-name"
              onClick={() => openEntry(e.type, e)}
            >
              <strong>{e.note || e.category}</strong>
              <small>
                {e.category} ·{" "}
                {data.wallets.find((w) => w.id === e.wallet)?.name}
                {e.origin ? " · Định kỳ" : ""}
              </small>
            </button>
            <span className="transaction-date">
              {e.date.split("-").reverse().join("/")}
            </span>
            <strong
              className={e.type === "income" ? "positive" : "amount-negative"}
            >
              {e.type === "income" ? "+" : "−"} {money(e.amount)}
            </strong>
            <button
              className="delete-btn"
              onClick={() => {
                if (confirm("Xóa giao dịch này?"))
                  save({
                    ...data,
                    entries: data.entries.filter((x) => x.id !== e.id),
                  });
              }}
              aria-label="Xóa giao dịch"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))
      ) : (
        <div className="empty">
          Chưa có giao dịch nào trong khoảng thời gian này.
        </div>
      )}
    </div>
  );
  return (
    <div className={`app-shell${motionEnabled ? "" : " motion-off"}`}>
      <PetalFall enabled={motionEnabled} />
      {busy && (
        <div className="saving-overlay" role="status">
          Đang lưu...
        </div>
      )}
      <aside ref={sidebarRef} id="sidebar-navigation" className={`sidebar ${menu ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Image src="/logo.png" alt="" width={38} height={38} />
          </div>
          <div>
            <strong>
              nhà mình<span>.</span>
            </strong>
            <small>SỔ THU CHI</small>
          </div>
          <button
            className="mobile-close icon-btn"
            onClick={closeSidebar}
            aria-label="Đóng menu"
          >
            <X size={19} />
          </button>
        </div>
        <button type="button" className="workspace" aria-label="Mở tổng quan sổ cá nhân" onClick={() => { setTab("overview"); setMenu(false); }}>
          <div className="workspace-icon">N</div>
          <div>
            <strong>Không gian của tôi</strong>
            <small>Sổ cá nhân</small>
          </div>
        </button>
        <p className="side-label">KHÔNG GIAN CỦA BẠN</p>
        <nav>
          {nav.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`nav-item ${tab === id ? "active" : ""}`}
              onClick={() => {
                setTab(id);
                setMenu(false);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {tab === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="tip">
            <Sparkles size={18} />
            <strong>
              Mỗi khoản nhỏ,
              <br />
              một kế hoạch lớn.
            </strong>
            <p>Ghi chép hôm nay để an tâm hơn ngày mai.</p>
          </div>
          <button className="nav-item" onClick={() => { setTab("settings"); setMenu(false); }}>
            <Settings size={18} /> Cài đặt
          </button>
          <button type="button" className="profile" aria-label="Cài đặt tài khoản" onClick={() => { setTab("settings"); setMenu(false); }}>
            <div className="avatar">{renderAvatar()}</div>
            <div>
              <strong>{user.phone || "Tài khoản"}</strong>
              <small>Chủ sở hữu</small>
            </div>
            <MoreHorizontal size={18} />
          </button>
        </div>
      </aside>
      {menu && <button ref={sidebarBackdropRef} type="button" className="sidebar-backdrop" aria-label="Đóng thanh bên" onClick={closeSidebar} />}
      <main className="main" ref={mainRef}>
        <header className="topbar">
          <button
            className="icon-btn hamburger"
            onClick={() => setMenu(true)}
            aria-label="Mở menu"
            aria-expanded={menu}
            aria-controls="sidebar-navigation"
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <button type="button" className="breadcrumb-home" onClick={() => setTab("overview")}>Không gian của tôi</button> <span>/</span>{" "}
            <strong>{nav.find((x) => x.id === tab)?.label || "Cài đặt"}</strong>
          </div>
          <div className="top-actions">
            <span className="local-pill">
              <span />{" "}
              {busy
                ? "Đang lưu"
                : syncError
                  ? "Chưa lưu"
                  : loadError
                    ? "Chưa đồng bộ"
                    : "Đã đồng bộ"}
            </span>
            <button
              className="icon-btn"
              aria-label="Thông tin"
              onClick={() => setTab("settings")}
            >
              <CircleHelp size={19} />
            </button>
            <button type="button" className="avatar small avatar-button" aria-label="Mở tài khoản" onClick={() => { setTab("settings"); setMenu(false); }}>{renderAvatar()}</button>
          </div>
        </header>
        <div className="content">
          {loadError && (
            <div className="sync-error" role="alert">
              <span>{loadError} Dữ liệu hiển thị có thể chưa mới nhất.</span>
              <button onClick={() => void refresh()}>Thử kết nối lại</button>
            </div>
          )}
          {recurringError && (
            <div className="sync-error" role="alert">
              <span>{recurringError}</span>
              <button onClick={() => void refresh()}>Kiểm tra lại</button>
            </div>
          )}
          {syncError && (
            <div className="sync-error" role="alert">
              <span>{syncError}</span>
              <button onClick={() => save(data)}>Thử lưu lại</button>
              <button
                onClick={() => {
                  if (
                    confirm(
                      "Tải dữ liệu mới? Bản nháp vẫn được giữ trên thiết bị để khôi phục sau.",
                    )
                  )
                    void refresh(true);
                }}
              >
                Tải dữ liệu mới
              </button>
            </div>
          )}
          {drafts.length > 0 && (
            <div className="draft-list" aria-label="Bản nháp trên thiết bị">
              <strong>{drafts.length} bản nháp chưa được xác nhận</strong>
              <p>
                Bản nháp lưu trên trình duyệt của thiết bị này, không mã hóa.
                Chỉ khôi phục khi đang dùng đúng tài khoản.
              </p>
              {drafts.map((draft) => (
                <div className="draft-row" key={draft.key}>
                  <span>
                    {new Date(draft.createdAt).toLocaleString("vi-VN")}
                  </span>
                  <button
                    onClick={() => {
                      if (
                        dirtyRef.current &&
                        activeDraftId.current !== draft.id &&
                        !confirm(
                          "Chuyển sang bản nháp khác? Bản hiện tại vẫn được giữ trên thiết bị.",
                        )
                      )
                        return;
                      activeDraftId.current = draft.id;
                      dirtyRef.current = true;
                      version.current = draft.expectedVersion;
                      setData(draft.data);
                      setSyncError(
                        "Đang xem bản nháp. Chọn Thử lưu lại; nếu có xung đột, hãy tải bản mới và nhập lại thay đổi.",
                      );
                    }}
                  >
                    Khôi phục
                  </button>
                  <button
                    onClick={() => {
                      if (
                        !confirm(
                          "Xóa bản nháp này khỏi thiết bị? Thao tác không thể hoàn tác.",
                        )
                      )
                        return;
                      try {
                        removeDraft(localStorage, user.id, draft.key);
                        updateDrafts();
                        if (activeDraftId.current === draft.id)
                          void refresh(true);
                      } catch {
                        alert("Không thể xóa bản nháp trên thiết bị.");
                      }
                    }}
                  >
                    Xóa bản nháp
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                SỔ THU CHI CỦA BẠN <span>✳</span>
              </div>
              <h1>
                {tab === "overview"
                  ? "Chào bạn, hôm nay thế nào?"
                  : nav.find((x) => x.id === tab)?.label || "Cài đặt"}
              </h1>
              <p>
                {tab === "overview"
                  ? "Một chút quan tâm mỗi ngày, tài chính thêm thảnh thơi."
                  : "Theo dõi tài chính của bạn."}
              </p>
            </div>
            <button className="primary-btn" aria-label="Thêm giao dịch" onClick={() => openEntry()}>
              <Plus size={18} aria-hidden="true" /> <span className="add-transaction-label">Thêm giao dịch</span>
            </button>
          </div>
          {!["settings", "wallets", "recurring"].includes(tab) && (
            <div className="period-row">
              <div className="period">
                <CalendarDays size={16} />
                <button
                  onClick={() => changeMonth(-1)}
                  aria-label="Tháng trước"
                >
                  <ChevronLeft size={17} />
                </button>
                <strong>{monthLabel(month)}</strong>
                <button onClick={() => changeMonth(1)} aria-label="Tháng sau">
                  <ChevronRight size={17} />
                </button>
              </div>
              <span>Dữ liệu trong tháng được chọn</span>
            </div>
          )}
          {(tab === "overview" || tab === "reports") && (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-top">
                    <span>TỔNG THU NHẬP</span>
                    <span className="stat-icon green">
                      <TrendingUp size={17} />
                    </span>
                  </div>
                  <strong>{money(income)}</strong>
                  <small>
                    <span className="positive">↗ Thu nhập</span> tháng này
                  </small>
                </div>
                <div className="stat-card">
                  <div className="stat-top">
                    <span>TỔNG CHI TIÊU</span>
                    <span className="stat-icon peach">
                      <TrendingDown size={17} />
                    </span>
                  </div>
                  <strong>{money(expense)}</strong>
                  <small>
                    <span className="negative">↘ Chi tiêu</span> tháng này
                  </small>
                </div>
                <div className="stat-card dark">
                  <div className="stat-top">
                    <span>CÒN LẠI TRONG THÁNG</span>
                    <span className="stat-icon translucent">
                      <Wallet size={17} />
                    </span>
                  </div>
                  <strong>{money(income - expense)}</strong>
                  <small>
                    Thu nhập trừ đi chi tiêu <span>✳</span>
                  </small>
                </div>
              </div>
              <div className="section-grid">
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <div className="card-kicker">DÒNG TIỀN CỦA BẠN</div>
                      <h2>Giao dịch gần đây</h2>
                      <p>Những khoản thu chi mới nhất trong tháng.</p>
                    </div>
                    <button
                      className="text-link"
                      onClick={() => setTab("transactions")}
                    >
                      Xem tất cả <ArrowRight size={15} />
                    </button>
                  </div>
                  {renderTransactionList(entries.slice(0, 5))}
                </section>
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <div className="card-kicker">KẾ HOẠCH CHI TIÊU</div>
                      <h2>Ngân sách tháng</h2>
                      <p>Cứ chậm rãi, bạn đang làm tốt lắm.</p>
                    </div>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        setBudgetInput(String(budget || ""));
                        setModal("budget");
                      }}
                      aria-label="Sửa ngân sách"
                    >
                      <MoreHorizontal size={20} />
                    </button>
                  </div>
                  <div className="budget-number">
                    <strong>{money(expense)}</strong>
                    <span> / {budget ? money(budget) : "Chưa đặt"}</span>
                  </div>
                  <div className="progress">
                    <div style={{ width: `${Math.min(100, ratio)}%` }} />
                  </div>
                  <div className="progress-label">
                    <span>Đã dùng {Math.round(ratio)}%</span>
                    <span>
                      {budget
                        ? `${expense > budget ? "Vượt" : "Còn lại"} ${money(Math.abs(budget - expense))}`
                        : "Hãy đặt ngân sách"}
                    </span>
                  </div>
                  <div className="budget-illustration">
                    <div className="flower">✺</div>
                    <p>
                      Mỗi kế hoạch nhỏ đều đưa bạn đến gần hơn với mục tiêu.
                    </p>
                  </div>
                  <button
                    className="outline-btn full"
                    onClick={() => setTab("budget")}
                  >
                    Xem ngân sách <ArrowRight size={15} />
                  </button>
                </section>
              </div>
              <div className="lower-grid">
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <div className="card-kicker">HIỂU HƠN VỀ CHI TIÊU</div>
                      <h2>Chi tiêu theo danh mục</h2>
                    </div>
                    <button
                      className="text-link"
                      onClick={() => setTab("reports")}
                    >
                      Chi tiết <ArrowRight size={15} />
                    </button>
                  </div>
                  {breakdown.length ? (
                    visibleBreakdown(breakdown, tab === "reports").map(
                      ([name, value]) => (
                        <div className="category-row" key={name}>
                          <span
                            className="category-icon"
                            style={{
                              background: `${colors[name] || "#a5aaa4"}30`,
                              color: colors[name] || "#a5aaa4",
                            }}
                          >
                            {symbols[name] || "•"}
                          </span>
                          <span className="category-name">{name}</span>
                          <div className="mini-progress">
                            <div
                              style={{
                                width: `${expense ? (value / expense) * 100 : 0}%`,
                                background: colors[name] || "#a5aaa4",
                              }}
                            />
                          </div>
                          <strong>{money(value)}</strong>
                        </div>
                      ),
                    )
                  ) : (
                    <div className="empty">
                      Chưa có khoản chi trong tháng này.
                    </div>
                  )}
                </section>
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <div className="card-kicker">CÁC NGUỒN TIỀN</div>
                      <h2>Ví của tôi</h2>
                    </div>
                    <button
                      className="text-link"
                      onClick={() => setTab("wallets")}
                    >
                      Xem tất cả <ArrowRight size={15} />
                    </button>
                  </div>
                  {data.wallets.filter((w) => !w.archived).map((w) => (
                    <div className="wallet-row" key={w.id}>
                      <span className="wallet-icon">
                        <Wallet size={18} />
                      </span>
                      <div>
                        <strong>{w.name}</strong>
                        <small>Số dư theo ghi chép</small>
                      </div>
                      <b>
                        {money(
                          calculateWalletBalance(
                            w.balance,
                            w.id,
                            data.entries,
                            dateISO(),
                          ),
                        )}
                      </b>
                    </div>
                  ))}
                </section>
              </div>
            </>
          )}
          {tab === "transactions" && (
            <section className="card full-card">
              <div className="card-heading">
                <div>
                  <div className="card-kicker">DÒNG TIỀN CỦA BẠN</div>
                  <h2>Tất cả giao dịch</h2>
                  <p>
                    {list.length} giao dịch trong{" "}
                    {monthLabel(month).toLowerCase()}
                  </p>
                </div>
                <button className="outline-btn" onClick={() => openEntry()}>
                  <Plus size={16} /> Thêm mới
                </button>
              </div>
              <div className="filters">
                <label className="search">
                  <Search size={17} />
                  <input
                    placeholder="Tìm ghi chú hoặc danh mục..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="Lọc loại giao dịch"
                >
                  <option value="all">Tất cả giao dịch</option>
                  <option value="expense">Chi tiêu</option>
                  <option value="income">Thu nhập</option>
                </select>
              </div>
              {renderTransactionList(list)}
            </section>
          )}
          {tab === "wallets" && (
            <section className="card full-card">
              <div className="card-heading">
                <div>
                  <div className="card-kicker">CÁC NGUỒN TIỀN</div>
                  <h2>Ví và tài khoản</h2>
                  <p>Số dư được tính từ số dư ban đầu và giao dịch đã ghi.</p>
                </div>
                <button
                  className="outline-btn"
                  onClick={() => {
                    setWalletEditId(null);
                    setWalletName("");
                    setWalletBalance("0");
                    setModal("wallet");
                  }}
                >
                  <Plus size={16} /> Thêm ví
                </button>
              </div>
              {data.wallets.filter((w) => !w.archived).map((w) => (
                <div className="wallet-row large wallet-manage" key={w.id}>
                  <span className="wallet-icon">
                    <CreditCard size={20} />
                  </span>
                  <div>
                    <strong>{w.name}</strong>
                    <small>Số dư ban đầu: {money(w.balance)}</small>
                  </div>
                  <b>
                    {money(
                      calculateWalletBalance(
                        w.balance,
                        w.id,
                        data.entries,
                        dateISO(),
                      ),
                    )}
                  </b>
                  <div className="wallet-actions">
                    <button className="wallet-action" aria-label={`Sửa ví ${w.name}`} onClick={() => {
                      setWalletEditId(w.id);
                      setWalletName(w.name);
                      setWalletBalance(String(w.balance));
                      setModal("wallet");
                    }}>Sửa</button>
                    <button className="wallet-action wallet-remove" aria-label={`Xóa ví ${w.name}`} onClick={() => {
                      if (data.wallets.filter((item) => !item.archived).length <= 1) {
                        alert("Cần giữ ít nhất một ví đang sử dụng. Hãy thêm ví khác trước khi xóa ví này.");
                        return;
                      }
                      if (data.rules.some((rule) => rule.wallet === w.id)) {
                        alert("Ví này đang được dùng bởi giao dịch định kỳ. Hãy sửa các quy tắc định kỳ sang ví khác trước khi xóa.");
                        return;
                      }
                      const used = data.entries.some((entry) => entry.wallet === w.id);
                      if (!confirm(used
                        ? `Xóa ví “${w.name}” khỏi danh sách? Ví sẽ được lưu trữ để giữ lịch sử giao dịch và có thể khôi phục sau.`
                        : `Xóa ví “${w.name}”? Ví chưa có giao dịch và sẽ bị xóa khỏi sổ.`)) return;
                      save({ ...data, wallets: used
                        ? data.wallets.map((item) => item.id === w.id ? { ...item, archived: true } : item)
                        : data.wallets.filter((item) => item.id !== w.id) });
                    }}>Xóa</button>
                  </div>
                </div>
              ))}
              {data.wallets.some((w) => w.archived) && (
                <div className="archived-wallets">
                  <h3>Ví đã lưu trữ</h3>
                  <p>Lịch sử giao dịch vẫn được giữ. Khôi phục ví để sử dụng lại.</p>
                  {data.wallets.filter((w) => w.archived).map((w) => (
                    <div className="wallet-row wallet-manage" key={w.id}>
                      <span className="wallet-icon"><CreditCard size={20} /></span>
                      <div><strong>{w.name}</strong><small>Đã lưu trữ</small></div>
                      <button className="wallet-action" aria-label={`Khôi phục ví ${w.name}`} onClick={() => save({
                        ...data,
                        wallets: data.wallets.map((item) => item.id === w.id ? { ...item, archived: false } : item),
                      })}>Khôi phục</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="footnote">
                Chưa hỗ trợ chuyển tiền giữa các ví. Số dư chỉ phản ánh giao
                dịch được ghi trong ứng dụng.
              </p>
            </section>
          )}
          {tab === "budget" && (
            <section className="card full-card budget-detail">
              <div className="card-heading">
                <div>
                  <div className="card-kicker">KẾ HOẠCH CHI TIÊU</div>
                  <h2>Ngân sách tổng tháng</h2>
                  <p>Đặt giới hạn chi tiêu phù hợp với bạn.</p>
                </div>
                <button
                  className="outline-btn"
                  onClick={() => {
                    setBudgetInput(String(budget || ""));
                    setModal("budget");
                  }}
                >
                  <Target size={16} /> {budget ? "Điều chỉnh" : "Đặt ngân sách"}
                </button>
              </div>
              <div className="budget-number">
                <strong>{money(expense)}</strong>
                <span> / {budget ? money(budget) : "Chưa đặt"}</span>
              </div>
              <div className="progress">
                <div style={{ width: `${Math.min(100, ratio)}%` }} />
              </div>
              <div className="progress-label">
                <span>Đã dùng {Math.round(ratio)}%</span>
                <span>
                  {budget
                    ? `${expense > budget ? "Vượt" : "Còn lại"} ${money(Math.abs(budget - expense))}`
                    : "Chưa có ngân sách"}
                </span>
              </div>
              <div className="soft-note">
                ✳ &nbsp; Ngân sách được tính theo tổng chi trong tháng.
              </div>
            </section>
          )}
          {tab === "recurring" && (
            <section className="card full-card">
              <div className="card-heading">
                <div>
                  <div className="card-kicker">GHI NHỚ GIÚP BẠN</div>
                  <h2>Giao dịch định kỳ</h2>
                  <p>Các giao dịch lặp hàng tháng.</p>
                </div>
                <button className="outline-btn" onClick={() => openEntry()}>
                  <Plus size={16} /> Tạo giao dịch
                </button>
              </div>
              <div className="soft-note">
                Giao dịch đến hạn được xử lý từ 07:00 và thử lại mỗi 15 phút,
                theo giờ Việt Nam. Thay đổi chỉ áp dụng cho các kỳ chưa được
                ghi.
              </div>
              {data.rules.length ? (
                data.rules.map((r) => (
                  <div className="wallet-row large recurring-row" key={r.id}>
                    <span className="wallet-icon">
                      <Repeat2 size={19} />
                    </span>
                    <div className="recurring-info">
                      <strong>{r.note || r.category}</strong>
                      <small>
                        Lần tiếp theo: {r.next} ·{" "}
                        {r.active ? "Đang hoạt động" : "Đã tạm dừng"}
                      </small>
                    </div>
                    <b className="recurring-amount">{money(r.amount)}</b>
                    <div className="recurring-actions">
                    <button
                      className="text-link"
                      onClick={() => {
                        setRuleId(r.id);
                        setKind(r.type);
                        setAmount(String(r.amount));
                        setShowAmountSuggestions(false);
                        setCategory(r.category);
                        setNote(r.note);
                        setWallet(r.wallet);
                        setDate(r.next);
                        setModal("rule");
                      }}
                    >
                      Sửa
                    </button>
                    <button
                      className="text-link"
                      onClick={() =>
                        save({
                          ...data,
                          rules: data.rules.map((x) =>
                            x.id === r.id ? { ...x, active: !x.active } : x,
                          ),
                        })
                      }
                    >
                      {r.active ? "Tạm dừng" : "Tiếp tục"}
                    </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">
                  Chưa có giao dịch định kỳ. Chọn “Lặp lại hàng tháng” khi thêm
                  giao dịch.
                </div>
              )}
            </section>
          )}
          {tab === "settings" && (
            <section className="card full-card">
              <div className="card-kicker">KHÔNG GIAN CỦA BẠN</div>
              <h2>Cài đặt & dữ liệu</h2>
              <div className="setting-row account-summary">
                <div>
                  <strong>Tài khoản của bạn</strong>
                  <p>{user.phone || "Sổ cá nhân"} · Chủ sở hữu</p>
                </div>
              </div>
              <div className="setting-row avatar-settings">
                <div className="avatar-preview avatar">{renderAvatar()}</div>
                <div className="avatar-details">
                  <strong>Ảnh đại diện</strong>
                  <p>JPG, PNG hoặc WebP, tối đa 5 MB. Ảnh được cắt vuông và đồng bộ theo tài khoản.</p>
                  {avatarError && modal !== "avatar" && <p className="avatar-error" role="alert">{avatarError}</p>}
                </div>
                <div className="avatar-actions">
                  <label className="outline-btn avatar-upload">{avatar ? "Đổi ảnh" : "Chọn ảnh"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={changeAvatar} /></label>
                  {avatar && <button type="button" className="outline-btn" onClick={() => save({ ...data, avatar: null })}>Xóa ảnh</button>}
                </div>
              </div>
              <div className="setting-row motion-settings">
                <div>
                  <strong>Hiệu ứng hoa đào</strong>
                  <p>Hoa rơi nhẹ và chuyển động giao diện. Có thể tắt trên thiết bị này; tự tắt nếu thiết bị bật giảm chuyển động.</p>
                </div>
                <button type="button" className="outline-btn" aria-pressed={motionEnabled} onClick={toggleMotion}>
                  {motionEnabled ? "Tắt hiệu ứng" : "Bật hiệu ứng"}
                </button>
              </div>
              <div className="soft-note">
                Dữ liệu được lưu theo tài khoản của bạn. Số điện thoại chưa được
                xác minh qua SMS và hiện chưa có khôi phục mật khẩu tự động.
              </div>
              <div className="setting-row">
                <div>
                  <strong>Danh mục</strong>
                  <p>Thêm danh mục thu hoặc chi phù hợp với bạn.</p>
                </div>
                <button
                  className="outline-btn"
                  onClick={() => setModal("category")}
                >
                  Quản lý danh mục
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Chuyển dữ liệu bản thử</strong>
                  <p>
                    Nhập dữ liệu từ trình duyệt này vào sổ mới; dữ liệu mẫu cũng
                    sẽ được chuyển.
                  </p>
                </div>
                <button
                  className="outline-btn"
                  onClick={() => {
                    try {
                      const raw = localStorage.getItem("nha-minh-finance-v1");
                      if (!raw) {
                        alert(
                          "Không tìm thấy dữ liệu bản thử trên trình duyệt này.",
                        );
                        return;
                      }
                      if (
                        data.entries.length ||
                        data.rules.length ||
                        Object.keys(data.budgets).length ||
                        data.wallets.length !== 1 ||
                        data.wallets[0].id !== "cash" ||
                        data.wallets[0].balance !== 0
                      ) {
                        alert(
                          "Chỉ có thể nhập vào sổ mới còn trống. Dữ liệu hiện tại không bị thay đổi.",
                        );
                        return;
                      }
                      const old = JSON.parse(raw);
                      if (
                        !Array.isArray(old.entries) ||
                        !Array.isArray(old.wallets) ||
                        !Array.isArray(old.rules) ||
                        typeof old.categories !== "object" ||
                        typeof old.budgets !== "object"
                      ) {
                        alert("Dữ liệu bản thử không hợp lệ.");
                        return;
                      }
                      if (
                        confirm(
                          `Chuyển ${old.entries.length} giao dịch và ${old.wallets.length} ví từ bản thử trên thiết bị này? Dữ liệu mẫu cũng sẽ được chuyển.`,
                        )
                      )
                        save(old);
                    } catch {
                      alert("Không thể đọc dữ liệu bản thử.");
                    }
                  }}
                >
                  Chuyển dữ liệu
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Phiên đăng nhập</strong>
                  <p>{user.phone}</p>
                </div>
                <button
                  className="outline-btn"
                  onClick={() => void client.auth.signOut()}
                >
                  Đăng xuất
                </button>
              </div>
            </section>
          )}
          <footer>
            <span>
              Được chăm chút cho những điều giản dị.{" "}
              <span className="heart">♥</span>
            </span>
            <span>nhà mình. &nbsp;·&nbsp; Sổ thu chi của bạn</span>
          </footer>
        </div>
      </main>
      <nav className="mobile-nav">
        {nav.slice(0, 5).map(({ id, label, Icon }) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => { setTab(id); setMenu(false); }}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Biểu mẫu"
          >
            <div className="modal-head">
              <div>
                <div className="card-kicker">SỔ THU CHI</div>
                <h2>
                  {modal === "avatar"
                    ? "Điều chỉnh ảnh đại diện"
                    : modal === "rule"
                    ? "Sửa giao dịch định kỳ"
                    : modal === "entry"
                      ? editId
                        ? "Sửa giao dịch"
                        : "Thêm giao dịch"
                      : modal === "wallet"
                          ? walletEditId ? "Sửa ví" : "Thêm ví mới"
                        : modal === "budget"
                          ? "Ngân sách tháng"
                          : "Quản lý danh mục"}
                </h2>
              </div>
              <button
                className="icon-btn"
                onClick={closeModal}
                aria-label="Đóng"
              >
                <X size={21} />
              </button>
            </div>
            {modal === "avatar" && avatarFile && <AvatarEditor file={avatarFile} onSave={(crop) => void saveAvatar(crop)} onCancel={closeModal} error={avatarError} busy={busy} motionEnabled={motionEnabled} />}
            {(modal === "entry" || modal === "rule") && (
              <form onSubmit={submitEntry}>
                {modal === "rule" && (
                  <p className="modal-desc">
                    Thay đổi áp dụng cho các kỳ chưa ghi, kể cả kỳ quá hạn nếu
                    còn. Những giao dịch đã ghi không thay đổi.
                  </p>
                )}
                <div className="type-switch">
                  <button
                    type="button"
                    className={kind === "expense" ? "selected" : ""}
                    onClick={() => {
                      setKind("expense");
                      setCategory(data.categories.expense[0]);
                    }}
                  >
                    Khoản chi
                  </button>
                  <button
                    type="button"
                    className={kind === "income" ? "selected" : ""}
                    onClick={() => {
                      setKind("income");
                      setCategory(data.categories.income[0]);
                    }}
                  >
                    Khoản thu
                  </button>
                </div>
                <label>
                  Số tiền <span>*</span>
                  <div className="amount-input">
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      required
                      placeholder="0"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setShowAmountSuggestions(true);
                      }}
                    />
                    <b>₫</b>
                  </div>
                </label>
                {showAmountSuggestions && /^[0-9]+$/.test(amount) && Number(amount) > 0 && Number.isSafeInteger(Number(amount) * 1000) && (
                  <div className="amount-suggestions" role="group" aria-label="Gợi ý số tiền">
                    <p>Chọn nhanh số tiền</p>
                    <div>
                      {[1000, 10000, 100000]
                        .map((multiplier) => Number(amount) * multiplier)
                        .filter((value) => Number.isSafeInteger(value))
                        .map((value) => (
                          <button key={value} type="button" onClick={() => {
                            setAmount(String(value));
                            setShowAmountSuggestions(false);
                          }}>{money(value)}</button>
                        ))}
                    </div>
                  </div>
                )}
                <div className="form-grid">
                  <label>
                    {modal === "rule"
                      ? "Ngày chạy tiếp theo"
                      : "Ngày giao dịch"}{" "}
                    <span>*</span>
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <label>
                    Ví / tài khoản <span>*</span>
                    <select
                      required
                      value={wallet}
                      onChange={(e) => setWallet(e.target.value)}
                    >
                      {data.wallets.filter((w) => !w.archived || w.id === wallet).map((w) => (
                        <option value={w.id} key={w.id}>
                          {w.name}{w.archived ? " (đã lưu trữ)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Danh mục <span>*</span>
                  <select
                    required
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {data.categories[kind].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Ghi chú <em>không bắt buộc</em>
                  <input
                    placeholder="Ví dụ: Bữa trưa cùng gia đình"
                    maxLength={2000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                {modal === "entry" && !editId && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={repeat}
                      onChange={(e) => setRepeat(e.target.checked)}
                    />{" "}
                    Lặp lại hàng tháng
                  </label>
                )}
                <button className="primary-btn form-submit" type="submit">
                  {editId || modal === "rule"
                    ? "Lưu thay đổi"
                    : "Lưu giao dịch"}{" "}
                  <ArrowRight size={17} />
                </button>
              </form>
            )}
            {modal === "wallet" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!walletName.trim()) return;
                  if (
                    save({
                      ...data,
                      wallets: walletEditId
                        ? data.wallets.map((item) => item.id === walletEditId ? { ...item, name: walletName.trim(), balance: Number(walletBalance) || 0 } : item)
                        : [...data.wallets, { id: uid(), name: walletName.trim(), balance: Number(walletBalance) || 0 }],
                    })
                  ) {
                    setWalletName("");
                    setWalletBalance("0");
                    setModal(null);
                  }
                }}
              >
                <label>
                  Tên ví
                  <input
                    required
                    value={walletName}
                    onChange={(e) => setWalletName(e.target.value)}
                    placeholder="Ví dụ: Tiền mặt"
                  />
                </label>
                <label>
                  Số dư ban đầu (₫)
                  <input
                    type="number"
                    step="1"
                    value={walletBalance}
                    onChange={(e) => setWalletBalance(e.target.value)}
                  />
                </label>
                <p className="modal-desc">Số dư hiện tại = số dư ban đầu + các khoản thu − các khoản chi đã ghi. Thay đổi số dư ban đầu sẽ thay đổi số dư hiện tại.</p>
                <button className="primary-btn form-submit">{walletEditId ? "Lưu thay đổi" : "Thêm ví"}</button>
              </form>
            )}
            {modal === "budget" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = Number(budgetInput);
                  if (n <= 0) return;
                  if (
                    save({ ...data, budgets: { ...data.budgets, [month]: n } })
                  )
                    setModal(null);
                }}
              >
                <p className="modal-desc">
                  Đặt tổng ngân sách chi tiêu cho{" "}
                  {monthLabel(month).toLowerCase()}.
                </p>
                <label>
                  Ngân sách (₫)
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    placeholder="Ví dụ: 10000000"
                  />
                </label>
                <button className="primary-btn form-submit">
                  Lưu ngân sách
                </button>
              </form>
            )}
            {modal === "category" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const c = newCategory.trim();
                  if (!c || data.categories[kind].includes(c)) return;
                  if (
                    save({
                      ...data,
                      categories: {
                        ...data.categories,
                        [kind]: [...data.categories[kind], c],
                      },
                    })
                  )
                    setNewCategory("");
                }}
              >
                <div className="type-switch">
                  <button
                    type="button"
                    className={kind === "expense" ? "selected" : ""}
                    onClick={() => setKind("expense")}
                  >
                    Chi tiêu
                  </button>
                  <button
                    type="button"
                    className={kind === "income" ? "selected" : ""}
                    onClick={() => setKind("income")}
                  >
                    Thu nhập
                  </button>
                </div>
                <div className="category-chips">
                  {data.categories[kind].map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                <label>
                  Tên danh mục mới
                  <input
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder="Nhập tên danh mục"
                  />
                </label>
                <button className="primary-btn form-submit">
                  Thêm danh mục
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
