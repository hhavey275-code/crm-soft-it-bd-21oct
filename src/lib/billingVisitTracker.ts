import { useEffect, useState, useCallback } from "react";

export type BillingVisit = {
  accountId: string;
  accountName: string;
  visitedAt: number;
};

const STORAGE_KEY = "crm:billing-visits:v1";
const MAX_ENTRIES = 50;

function read(): BillingVisit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v) =>
        v &&
        typeof v.accountId === "string" &&
        typeof v.accountName === "string" &&
        typeof v.visitedAt === "number"
    );
  } catch {
    return [];
  }
}

function write(list: BillingVisit[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    // Notify same-tab listeners (storage event only fires in OTHER tabs)
    window.dispatchEvent(new CustomEvent("billing-visits-changed"));
  } catch {
    /* ignore quota errors */
  }
}

export function recordBillingVisit(accountId: string, accountName: string) {
  const current = read();
  // Remove any existing entry for this account, then unshift fresh
  const filtered = current.filter((v) => v.accountId !== accountId);
  const next: BillingVisit[] = [
    { accountId, accountName, visitedAt: Date.now() },
    ...filtered,
  ].slice(0, MAX_ENTRIES);
  write(next);
}

export function clearBillingVisits() {
  write([]);
}

export function useBillingVisits() {
  const [visits, setVisits] = useState<BillingVisit[]>(() => read());

  useEffect(() => {
    const sync = () => setVisits(read());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("billing-visits-changed", sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("billing-visits-changed", sync);
    };
  }, []);

  const recordVisit = useCallback((accountId: string, accountName: string) => {
    recordBillingVisit(accountId, accountName);
  }, []);

  const clearVisits = useCallback(() => {
    clearBillingVisits();
  }, []);

  const lastVisit = visits[0] ?? null;

  return { visits, lastVisit, recordVisit, clearVisits };
}

export function formatVisitAge(visitedAt: number): string {
  const diff = Date.now() - visitedAt;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}