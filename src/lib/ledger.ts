export type Draft<T> = {
  key: string;
  id: string;
  expectedVersion: number;
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
  expectedVersion: number,
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
        Number.isSafeInteger(item.expectedVersion) &&
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
