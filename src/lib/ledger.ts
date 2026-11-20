export type Draft<T> = {
  key: string;
  id: string;
  expectedVersion: number | string;
  data: T;
  createdAt: number;
};

type StorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const draftPrefix = (ownerId: string) => `nha-minh-draft-v1:${ownerId}:`;

/** A separate key per edit avoids one tab overwriting another tab's draft. */
export function writeDraft<T>(
  storage: StorageLike,
  ownerId: string,
  id: string,
  expectedVersion: number | string,
  data: T,
): Draft<T> {
  const draft = {
    key: draftPrefix(ownerId) + id,
    id,
    expectedVersion,
    data,
    createdAt: Date.now(),
  };
  storage.setItem(draft.key, JSON.stringify(draft));
  return draft;
}

export function listDrafts<T>(
  storage: StorageLike,
  ownerId: string,
): Draft<T>[] {
  const drafts: Draft<T>[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(draftPrefix(ownerId))) continue;
    try {
      const item = JSON.parse(storage.getItem(key) || "null");
      if (
        item?.key === key &&
        typeof item.id === "string" &&
        draftPrefix(ownerId) + item.id === key &&
        (Number.isSafeInteger(item.expectedVersion) || (typeof item.expectedVersion === "string" && /^\d+:(?:none|[0-9a-f-]{36}):\d+$/.test(item.expectedVersion))) &&
        item.data &&
        Number.isFinite(item.createdAt)
      ) {
        drafts.push(item as Draft<T>);
      }
    } catch {
      // Leave unreadable data untouched; it may still be manually recoverable.
    }
  }
  return drafts.sort((a, b) => b.createdAt - a.createdAt);
}

export function removeDraft(
  storage: StorageLike,
  ownerId: string,
  key: string,
) {
  if (!key.startsWith(draftPrefix(ownerId)))
    throw new Error("Draft belongs to another account");
  storage.removeItem(key);
}

/** JSONB may return object keys in a different order from the client. */
export function equalJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, i) => equalJson(item, b[i]));
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) ||
    Array.isArray(b)
  )
    return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && equalJson(left[key], right[key]),
    )
  );
}

function transactionTime(value: string | null | undefined): { milliseconds: number; microseconds: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const fraction = (match[2] || "").padEnd(6, "0");
  const milliseconds = Date.parse(`${match[1]}.${fraction.slice(0, 3)}${match[3]}`);
  return Number.isFinite(milliseconds) ? { milliseconds, microseconds: Number(fraction.slice(3, 6)) } : null;
}

/** Sort without relying on wallet grouping or the order returned by the server. */
export function compareTransactions(
  a: { id: string; date: string; createdAt?: string | null },
  b: { id: string; date: string; createdAt?: string | null },
): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const aTime = transactionTime(a.createdAt), bTime = transactionTime(b.createdAt);
  if (!!aTime !== !!bTime) return aTime ? -1 : 1;
  if (aTime && bTime) {
    if (aTime.milliseconds !== bTime.milliseconds) return aTime.milliseconds < bTime.milliseconds ? 1 : -1;
    if (aTime.microseconds !== bTime.microseconds) return aTime.microseconds < bTime.microseconds ? 1 : -1;
  }
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/** Compare saved financial data despite server-owned metadata and wallet grouping. */
export function equalLedgerAfterServerStamp(a: unknown, b: unknown): boolean {
  const strip = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const ledger = value as Record<string, unknown>;
    if (!Array.isArray(ledger.entries)) return value;
    const entries = ledger.entries.map((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const copy = { ...entry } as Record<string, unknown>;
      delete copy.createdAt;
      delete copy.createdBy;
      return copy;
    });
    const ids = entries.map((entry: unknown) => entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>).id : null);
    if (ids.every(id => typeof id === "string") && new Set(ids).size === ids.length) {
      entries.sort((left, right) => {
        const aId = (left as { id: string }).id, bId = (right as { id: string }).id;
        return aId === bId ? 0 : aId < bId ? -1 : 1;
      });
    }
    return { ...ledger, entries };
  };
  return equalJson(strip(a), strip(b));
}

export function calculateWalletBalance(
  opening: number,
  walletId: string,
  entries: {
    wallet: string;
    date: string;
    type: "income" | "expense";
    amount: number;
  }[],
  today: string,
): number {
  return entries
    .filter((entry) => entry.wallet === walletId && entry.date <= today)
    .reduce(
      (balance, entry) =>
        balance + (entry.type === "income" ? entry.amount : -entry.amount),
      opening,
    );
}

export function budgetPercent(expense: number, budget: number): number {
  return budget > 0 ? (expense / budget) * 100 : 0;
}

export function visibleBreakdown<T>(items: T[], report: boolean): T[] {
  return report ? items : items.slice(0, 4);
}
