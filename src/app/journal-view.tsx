"use client";
import { BookHeart, CalendarDays, Image as ImageIcon, LockKeyhole, Plus, Sparkles, UsersRound } from "lucide-react";
import type { ReactNode } from "react";

export type JournalCardData = { id:string; title:string; body:string; date:string; visibility:"private"|"family"; photos:string[]; authorName:string; editable:boolean };
function dateLabel(value:string) {
  const [year,month,day]=value.split("-");
  return day && month && year ? `${day} THÁNG ${Number(month)}, ${year}` : value;
}
export function JournalView({entries,loading,error,onCreate,onOpen,onRetry,renderPhoto,filters,filtered=false}:{entries:JournalCardData[];loading:boolean;error:string;onCreate:()=>void;onOpen:(entry:JournalCardData)=>void;onRetry:()=>void;renderPhoto:(photo:string,alt:string)=>ReactNode;filters?:ReactNode;filtered?:boolean}) {
  return <section className="memories-page" aria-label="Nhật ký và kỷ niệm">
    <div className="memories-hero">
      <div className="memories-hero-copy"><span className="memories-eyebrow"><Sparkles size={15} aria-hidden="true" /> MỘT GÓC NHỎ CỦA MÌNH</span><h2>Những điều mình<br /><em>muốn nhớ mãi.</em></h2><p>Một câu chuyện nhỏ, một tấm hình xinh — cất giữ những ngày bình thường mà thật đặc biệt.</p><button type="button" className="memories-create" onClick={onCreate}><Plus size={17} aria-hidden="true"/> Viết kỷ niệm</button></div>
      <div className="memories-hero-art" aria-hidden="true"><span className="memories-paper memories-paper-back"/><span className="memories-paper memories-paper-front"><BookHeart size={39}/><small>nhà mình.</small></span><Sparkles className="memories-sparkle" size={26}/></div>
    </div>
    <div className="memories-list-heading"><div><span className="memories-kicker">NHỮNG TRANG ĐÃ LƯU</span><h2>Chuyện của chúng mình</h2><p>Những khoảnh khắc mình muốn nhớ.</p></div>{!loading && !error && <span className="memories-count">{entries.length} kỷ niệm</span>}</div>
    {filters}
    {loading ? <div className="memories-empty" role="status"><p>Đang mở những trang kỷ niệm…</p></div> : error ? <div className="memories-empty" role="alert"><p>{error}</p><button type="button" className="outline-btn" onClick={onRetry}>Thử lại</button></div> : !entries.length ? <div className="memories-empty"><span className="memories-empty-icon"><BookHeart size={27} aria-hidden="true"/></span><h3>{filtered ? "Chưa có kỷ niệm phù hợp" : "Trang đầu tiên đang chờ bạn"}</h3><p>{filtered ? "Hãy chọn bộ lọc khác để xem thêm kỷ niệm." : "Ghi lại một điều dễ thương, một ngày đáng nhớ hay bất cứ chuyện gì bạn muốn giữ lại."}</p><button type="button" className="outline-btn" onClick={onCreate}><Plus size={16} aria-hidden="true"/> Tạo kỷ niệm đầu tiên</button></div> : <div className="memories-grid">{entries.map(entry=><button type="button" className="memory-card" key={entry.id} onClick={()=>onOpen(entry)}>
      {entry.photos.length ? <span className="memory-card-image">{renderPhoto(entry.photos[0],"")}{entry.photos.length>1 && <span className="memory-photo-count"><ImageIcon size={13} aria-hidden="true"/> {entry.photos.length}</span>}</span> : <span className="memory-card-art" aria-hidden="true"><BookHeart size={30}/><span>những điều thương</span></span>}
      <span className="memory-card-body"><span className="memory-date"><CalendarDays size={13} aria-hidden="true"/> {dateLabel(entry.date)}</span><strong>{entry.title || "Một ngày đáng nhớ"}</strong><span className="memory-excerpt">{entry.body || "Một khoảnh khắc được cất giữ."}</span><span className="memory-card-footer"><span>{entry.visibility==="private" ? <LockKeyhole size={13} aria-hidden="true"/> : <UsersRound size={13} aria-hidden="true"/>}{entry.visibility==="private" ? "Riêng tư" : "Gia đình"}</span><span>{entry.authorName}</span></span></span>
    </button>)}</div>}
  </section>;
}
