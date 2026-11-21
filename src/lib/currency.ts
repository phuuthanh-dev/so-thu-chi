/** Monetary amounts are stored as whole VND or whole US cents. */
export type Currency = "VND" | "USD";
export function walletCurrency(value?: string | null): Currency {
  return value === "USD" ? "USD" : "VND";
}

/** Parse plain digits with an optional decimal point or comma for USD. */
export function parseMoney(input: string, currency: Currency): number | null {
  const text=input.trim();
  const match=(currency === "USD" ? /^(\d+)(?:[.,](\d{1,2}))?$/ : /^(\d+)$/).exec(text);
  if (!match) return null;
  const amount=BigInt(match[1]) * (currency === "USD" ? BigInt(100) : BigInt(1)) + (currency === "USD" ? BigInt((match[2] || "").padEnd(2,"0")) : BigInt(0));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}
export function parseSignedMoney(input: string, currency: Currency): number | null {
  const text = input.trim();
  const negative = text.startsWith("-");
  const value = parseMoney(negative ? text.slice(1) : text, currency);
  return value === null ? null : negative ? -value : value;
}
export function formatMoney(amount: number, currency: Currency): string {
  if (!Number.isSafeInteger(amount)) throw new Error("Invalid minor units");
  const negative = amount < 0, value = Math.abs(amount);
  if (currency === "VND") return `${negative ? "-" : ""}${new Intl.NumberFormat("vi-VN").format(value)}\u00a0₫`;
  const dollars = Math.floor(value / 100), cents=String(value % 100).padStart(2,"0");
  return `${negative ? "-" : ""}$${new Intl.NumberFormat("en-US").format(dollars)}.${cents}`;
}
export function moneyInput(amount: number, currency: Currency): string {
  if (!Number.isSafeInteger(amount)) throw new Error("Invalid minor units");
  if (currency === "VND") return String(amount);
  const sign=amount<0 ? "-" : "", value=Math.abs(amount);
  return `${sign}${Math.floor(value/100)}.${String(value%100).padStart(2,"0")}`;
}
