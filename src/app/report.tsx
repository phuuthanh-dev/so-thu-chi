import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, BarChart3, Sparkles } from "lucide-react";
import { buildReport, formatReportShare, type ReportEntry, type ReportKind } from "@/lib/report";
import { categoryAppearance } from "@/lib/category-icons";
import { CategoryIcon } from "./category-icon";

const money = (amount: number) => `${new Intl.NumberFormat("vi-VN").format(amount)}\u00a0₫`;
const labelMonth = (month: string) => `Tháng ${Number(month.slice(5))}/${month.slice(0, 4)}`;

function comparison(current: number, previous: number, previousCount: number, kind: ReportKind) {
  if (!previousCount) return `Tháng trước chưa có khoản ${kind === "income" ? "thu" : "chi"}`;
  const difference = current - previous;
  if (difference === 0) return "Không đổi so với tháng trước";
  return `${difference > 0 ? "Tăng" : "Giảm"} ${money(Math.abs(difference))} so với tháng trước`;
}

export function Report({ entries, month, onSelectMonth }: { entries: ReportEntry[]; month: string; onSelectMonth: (month: string) => void }) {
  const [kind, setKind] = useState<ReportKind>("expense");
  const report = useMemo(() => buildReport(entries, month), [entries, month]);
  const { current, previous, months, categories } = report;
  const total = current[kind];
  const maximum = Math.max(1, ...months.flatMap((item) => [item.income, item.expense]));
  const count = current.incomeCount + current.expenseCount;

  return (
    <div className="report-page">
      <section className="report-hero" aria-labelledby="report-balance-title">
        <div className="report-hero-copy">
          <span className="report-eyebrow"><Sparkles size={15} aria-hidden="true" /> NHÌN LẠI KỲ ĐÃ CHỌN</span>
          <h2 id="report-balance-title">Thu chi còn lại</h2>
          <p>Thu nhập trừ chi tiêu trong {labelMonth(month).toLowerCase()}</p>
          <strong className="report-net">{money(current.income - current.expense)}</strong>
          <span className="report-count">{count} giao dịch trong tháng</span>
        </div>
        <div className="report-flow">
          <div><span><ArrowDownLeft size={16} aria-hidden="true" /> Thu nhập</span><strong>{money(current.income)}</strong></div>
          <div><span><ArrowUpRight size={16} aria-hidden="true" /> Chi tiêu</span><strong>{money(current.expense)}</strong></div>
        </div>
      </section>
      <section className="report-comparison" aria-labelledby="report-compare-title">
        <div className="report-section-heading"><div><span className="card-kicker">SO SÁNH</span><h2 id="report-compare-title">So với tháng trước</h2></div><span className="report-period-tag">{labelMonth(previous.month)}</span></div>
        <div className="report-comparison-grid">
          <div className="report-comparison-card"><span>Thu nhập</span><strong>{money(current.income)}</strong><p>{comparison(current.income, previous.income, previous.incomeCount, "income")}</p></div>
          <div className="report-comparison-card"><span>Chi tiêu</span><strong>{money(current.expense)}</strong><p>{comparison(current.expense, previous.expense, previous.expenseCount, "expense")}</p></div>
        </div>
      </section>
      <div className="report-panels">
        <section className="card report-panel" aria-labelledby="report-trend-title">
          <div className="report-section-heading"><div><span className="card-kicker">DÒNG TIỀN THEO THỜI GIAN</span><h2 id="report-trend-title">Xu hướng 6 tháng</h2><p>Chọn một tháng để xem chi tiết.</p></div><span className="report-panel-icon"><BarChart3 size={19} aria-hidden="true" /></span></div>
          <div className="report-trend">
            {months.map((item) => <div className="report-trend-row" key={item.month}>
              <button type="button" className="report-month" aria-label={labelMonth(item.month)} aria-pressed={item.month === month} onClick={() => onSelectMonth(item.month)}>T{Number(item.month.slice(5))}/{item.month.slice(0, 4)}</button>
              <div className="report-trend-values">
                <div className="report-trend-line"><span>Thu</span><div className="report-bar" aria-hidden="true"><i className="report-bar-income" style={{ width: `${item.income / maximum * 100}%` }} /></div><strong>{money(item.income)}</strong></div>
                <div className="report-trend-line"><span>Chi</span><div className="report-bar" aria-hidden="true"><i className="report-bar-expense" style={{ width: `${item.expense / maximum * 100}%` }} /></div><strong>{money(item.expense)}</strong></div>
              </div>
            </div>)}
          </div>
        </section>
        <section className="card report-panel" aria-labelledby="report-category-title">
          <div className="report-section-heading"><div><span className="card-kicker">TIỀN ĐẾN VÀ ĐI ĐÂU?</span><h2 id="report-category-title">Phân tích danh mục</h2><p>Tỷ trọng trong {labelMonth(month).toLowerCase()} (đã làm tròn).</p></div></div>
          <div className="report-toggle" role="group" aria-label="Loại danh mục">
            <button type="button" aria-pressed={kind === "expense"} onClick={() => setKind("expense")}>Chi tiêu</button>
            <button type="button" aria-pressed={kind === "income"} onClick={() => setKind("income")}>Thu nhập</button>
          </div>
          {categories[kind].length ? <div className="report-categories">
            {categories[kind].map((category, index) => <div className="report-category" key={category.name}>
              <div className="report-category-heading"><span className="report-rank">{String(index + 1).padStart(2, "0")}</span><CategoryIcon name={category.name} kind={kind} /><div><strong>{category.name}</strong><small>{category.count} giao dịch · {formatReportShare(category.amount, total)}</small></div><b>{money(category.amount)}</b></div>
              <div className="report-category-bar" aria-hidden="true"><i style={{ width: `${total ? category.amount / total * 100 : 0}%`, background: categoryAppearance(category.name, kind).color }} /></div>
            </div>)}
          </div> : <div className="report-empty">Chưa có khoản {kind === "income" ? "thu" : "chi"} trong tháng này.</div>}
        </section>
      </div>
    </div>
  );
}
