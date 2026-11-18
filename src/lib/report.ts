export type ReportKind = "income" | "expense";
export type ReportEntry = { date: string; type: ReportKind; amount: number; category: string };
export type MonthTotals = { month: string; income: number; expense: number; incomeCount: number; expenseCount: number };

export function formatReportShare(amount: number, total: number): string {
  if (total <= 0 || amount <= 0) return "0%";
  if (amount === total) return "100%";
  const percentage = amount / total * 100;
  if (percentage < 0.1) return "<0,1%";
  if (percentage > 99.9) return ">99,9%";
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(percentage)}%`;
}

export function shiftReportMonth(month: string, offset: number): string {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(year, number - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function buildReport(entries: ReportEntry[], selectedMonth: string) {
  const months: MonthTotals[] = Array.from({ length: 6 }, (_, index) => ({
    month: shiftReportMonth(selectedMonth, index - 5), income: 0, expense: 0, incomeCount: 0, expenseCount: 0,
  }));
  const byMonth = new Map(months.map((item) => [item.month, item]));
  const categories: Record<ReportKind, Map<string, { amount: number; count: number }>> = {
    income: new Map(), expense: new Map(),
  };
  for (const entry of entries) {
    const month = entry.date.slice(0, 7);
    const total = byMonth.get(month);
    if (total) {
      total[entry.type] += entry.amount;
      total[entry.type === "income" ? "incomeCount" : "expenseCount"]++;
    }
    if (month === selectedMonth) {
      const category = categories[entry.type];
      const current = category.get(entry.category) || { amount: 0, count: 0 };
      category.set(entry.category, { amount: current.amount + entry.amount, count: current.count + 1 });
    }
  }
  const sorted = (kind: ReportKind) => Array.from(categories[kind], ([name, values]) => ({ name, ...values }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "vi"));
  return { months, current: months[5], previous: months[4], categories: { income: sorted("income"), expense: sorted("expense") } };
}
