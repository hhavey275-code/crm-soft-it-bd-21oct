import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * External (non-API) ad accounts are topped up by the CRM helper extension, so
 * the new spending limit only lands in our database on the next Meta sync.
 * After a client submits an external top-up request we therefore poll Meta for
 * that single account at 10s / 30s / 60s and surface a live "Updating your
 * limit..." indicator next to the account until the limit actually moves.
 */

export type LimitWatchStatus = "checking" | "updated" | "failed";

export interface LimitWatchState {
  status: LimitWatchStatus;
  baseline: number;
  newCap?: number;
}

/** Cumulative check times after the request: 10s, 30s, 60s. */
const CHECK_DELAYS_MS = [10_000, 20_000, 30_000];
const SUCCESS_CLEAR_MS = 20_000;
const FAILURE_CLEAR_MS = 5 * 60_000;

const store = new Map<string, LimitWatchState>();
const listeners = new Set<() => void>();
const timers = new Map<string, number[]>();

function emit() {
  listeners.forEach((l) => l());
}

function setState(accountId: string, state: LimitWatchState | null) {
  if (state) store.set(accountId, state);
  else store.delete(accountId);
  emit();
}

function clearTimers(accountId: string) {
  (timers.get(accountId) ?? []).forEach((t) => clearTimeout(t));
  timers.delete(accountId);
}

async function readSpendCap(accountId: string): Promise<number | null> {
  const { data } = await (supabase as any)
    .from("ad_accounts")
    .select("spend_cap")
    .eq("id", accountId)
    .maybeSingle();
  if (!data) return null;
  return Number(data.spend_cap ?? 0);
}

/** Pull this one account fresh from Meta so spend_cap is up to date. */
async function pullFromMeta(accountId: string) {
  try {
    await supabase.functions.invoke("get-account-insights", {
      body: { ad_account_ids: [accountId], source: "meta" },
    });
  } catch {
    /* transient failures are fine — the next attempt will retry */
  }
}

/**
 * Begin watching an account for a spending-limit increase.
 * @param onUpdated called once the limit actually increased (used to refresh lists)
 */
export async function startLimitWatch(
  accountId: string,
  fallbackBaseline: number,
  onUpdated?: () => void,
) {
  clearTimers(accountId);
  const current = await readSpendCap(accountId);
  const baseline = current ?? Number(fallbackBaseline ?? 0);
  setState(accountId, { status: "checking", baseline });

  const handles: number[] = [];
  let elapsed = 0;
  let settled = false;

  CHECK_DELAYS_MS.forEach((delay, index) => {
    elapsed += delay;
    const isLast = index === CHECK_DELAYS_MS.length - 1;
    const handle = window.setTimeout(async () => {
      if (settled) return;
      await pullFromMeta(accountId);
      if (settled) return;
      const cap = await readSpendCap(accountId);
      if (cap !== null && cap > baseline + 0.01) {
        settled = true;
        clearTimers(accountId);
        setState(accountId, { status: "updated", baseline, newCap: cap });
        onUpdated?.();
        window.setTimeout(() => {
          if (store.get(accountId)?.status === "updated") setState(accountId, null);
        }, SUCCESS_CLEAR_MS);
        return;
      }
      if (isLast) {
        settled = true;
        clearTimers(accountId);
        setState(accountId, { status: "failed", baseline });
        window.setTimeout(() => {
          if (store.get(accountId)?.status === "failed") setState(accountId, null);
        }, FAILURE_CLEAR_MS);
      }
    }, elapsed);
    handles.push(handle);
  });

  timers.set(accountId, handles);
}

export function dismissLimitWatch(accountId: string) {
  clearTimers(accountId);
  setState(accountId, null);
}

/** Subscribe to the live watch map (re-renders on any change). */
export function useLimitWatches(): Record<string, LimitWatchState> {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return Object.fromEntries(store.entries());
}
