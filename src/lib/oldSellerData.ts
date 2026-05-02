/**
 * Read-only data layer for the "Old Seller" archive audit page.
 *
 * Source of truth: `seller_transactions_archive_2026_05` (snapshot taken at the
 * May 2026 reset). Joined with the live `top_up_requests` table to figure out
 * which `client_topup` rows had their proof forwarded to Telegram.
 *
 * The archive table itself does NOT carry a `telegram_forwarded` column, so for
 * non-top-up types (bdt_payment / tenant_payment / withdraw / usdt_received)
 * we cannot retroactively know whether a proof was forwarded. Those are bucketed
 * as "manual entries" and shown separately so the operator can audit by hand.
 */

import { supabase } from "@/integrations/supabase/client";

// Top-up requests that were actually forwarded to Telegram but whose
// `telegram_forwarded` flag was never persisted (legacy rows). Treat these
// as forwarded for the archive audit view.
const FORCE_FORWARDED_TOPUP_IDS = new Set<string>([
  "a8788536-839d-4d10-be20-d5f5f76fa2cc", // DCV6NSLQ6M · Rasel · 31 Mar 2026
  "35777582-cd93-4324-8ad0-ee1d2e1dbe9d", // DD19P4W5U3 · Rasel · 1 Apr 2026
]);

export type ArchiveTxn = {
  id: string;
  seller_id: string;
  type: string; // bdt_payment | client_topup | tenant_payment | withdraw | usdt_received
  bdt_amount: number;
  usdt_amount: number;
  rate: number;
  description: string | null;
  bank_account_id: string | null;
  top_up_request_id: string | null;
  proof_url: string | null;
  created_at: string;
  status: string;
  entry_by_name: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  // joined / derived
  bank_name: string | null;
  account_number: string | null;
  topup_forwarded: boolean | null; // null when no linked top_up_request
  topup_amount_usd: number | null;
  topup_telegram_message_id: number | null;
};

export type ArchivedSeller = {
  seller_id: string;
  seller_name: string;
  seller_email: string;
  txn_count: number;
};

export async function fetchArchivedSellers(): Promise<ArchivedSeller[]> {
  const { data: rows, error } = await (supabase as any)
    .from("seller_transactions_archive_2026_05")
    .select("seller_id");
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of rows || []) {
    counts.set(r.seller_id, (counts.get(r.seller_id) || 0) + 1);
  }
  const ids = Array.from(counts.keys());
  if (ids.length === 0) return [];
  const { data: profs } = await (supabase as any)
    .from("profiles")
    .select("user_id, full_name, email")
    .in("user_id", ids);
  const profMap = new Map<string, any>();
  (profs || []).forEach((p: any) => profMap.set(p.user_id, p));
  return ids
    .map((id) => ({
      seller_id: id,
      seller_name: profMap.get(id)?.full_name || profMap.get(id)?.email || "Unknown",
      seller_email: profMap.get(id)?.email || "",
      txn_count: counts.get(id) || 0,
    }))
    .sort((a, b) => a.seller_name.localeCompare(b.seller_name));
}

export async function fetchSellerArchiveBundle(sellerId: string): Promise<{
  txns: ArchiveTxn[];
  topupRequests: any[];
}> {
  const { data: rawTxns, error } = await (supabase as any)
    .from("seller_transactions_archive_2026_05")
    .select("*")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const bankIds = Array.from(
    new Set((rawTxns || []).map((t: any) => t.bank_account_id).filter(Boolean)),
  );
  const topupIds = Array.from(
    new Set((rawTxns || []).map((t: any) => t.top_up_request_id).filter(Boolean)),
  );

  const [banksRes, topupsRes, archivePeriodTopupsRes] = await Promise.all([
    bankIds.length
      ? (supabase as any)
          .from("bank_accounts")
          .select("id, bank_name, account_number")
          .in("id", bankIds)
      : Promise.resolve({ data: [] }),
    topupIds.length
      ? (supabase as any)
          .from("top_up_requests")
          .select(
            "id, amount, bdt_amount, usd_rate, status, telegram_forwarded, telegram_forwarded_at, created_at, bank_account_id",
          )
          .in("id", topupIds)
      : Promise.resolve({ data: [] }),
    // ALL approved top-ups belonging to this seller's banks during the
    // archive period — used by the orphan-check panel.
    (async () => {
      const { data: sellerBanks } = await (supabase as any)
        .from("bank_accounts")
        .select("id")
        .eq("seller_id", sellerId);
      const ids = (sellerBanks || []).map((b: any) => b.id);
      if (!ids.length) return { data: [] };
      return (supabase as any)
        .from("top_up_requests")
        .select(
          "id, amount, bdt_amount, usd_rate, status, telegram_forwarded, telegram_forwarded_at, created_at, bank_account_id",
        )
        .in("bank_account_id", ids)
        .lte("created_at", "2026-05-02"); // archive cutoff
    })(),
  ]);

  const bankMap = new Map<string, any>();
  (banksRes.data || []).forEach((b: any) => bankMap.set(b.id, b));
  const topupMap = new Map<string, any>();
  (topupsRes.data || []).forEach((t: any) => topupMap.set(t.id, t));

  const txns: ArchiveTxn[] = (rawTxns || []).map((t: any) => {
    const bank = t.bank_account_id ? bankMap.get(t.bank_account_id) : null;
    const tu = t.top_up_request_id ? topupMap.get(t.top_up_request_id) : null;
    return {
      id: t.id,
      seller_id: t.seller_id,
      type: t.type,
      bdt_amount: Number(t.bdt_amount || 0),
      usdt_amount: Number(t.usdt_amount || 0),
      rate: Number(t.rate || 0),
      description: t.description,
      bank_account_id: t.bank_account_id,
      top_up_request_id: t.top_up_request_id,
      proof_url: t.proof_url,
      created_at: t.created_at,
      status: t.status,
      entry_by_name: t.entry_by_name,
      reviewed_by: t.reviewed_by,
      reviewed_at: t.reviewed_at,
      bank_name: bank?.bank_name || null,
      account_number: bank?.account_number || null,
      // Preserve NULL (legacy / unknown) so splitBuckets treats it as forwarded.
      // Only an explicit `false` means the operator marked it as NOT forwarded.
      topup_forwarded: tu ? (tu.telegram_forwarded === null || tu.telegram_forwarded === undefined ? null : Boolean(tu.telegram_forwarded)) : null,
      topup_amount_usd: tu ? Number(tu.amount || 0) : null,
      topup_telegram_message_id: null,
    };
  });

  return { txns, topupRequests: archivePeriodTopupsRes.data || [] };
}

export type Buckets = {
  forwardedIn: ArchiveTxn[]; // payments IN that were forwarded (top-ups + all manual entries)
  notForwardedIn: ArchiveTxn[]; // top-ups that were explicitly NOT forwarded — manual entries are ALSO mirrored here per operator rule
  usdtGiven: ArchiveTxn[];
  withdraws: ArchiveTxn[];
};

const IN_TYPES = new Set(["bdt_payment", "client_topup", "tenant_payment"]);
const MANUAL_TYPES = new Set(["bdt_payment", "tenant_payment"]);

export function splitBuckets(txns: ArchiveTxn[]): Buckets {
  const forwardedIn: ArchiveTxn[] = [];
  const notForwardedIn: ArchiveTxn[] = [];
  const usdtGiven: ArchiveTxn[] = [];
  const withdraws: ArchiveTxn[] = [];
  for (const t of txns) {
    if (t.status !== "approved") continue;
    if (t.type === "withdraw") {
      withdraws.push(t);
    } else if (t.type === "usdt_received") {
      usdtGiven.push(t);
    } else if (IN_TYPES.has(t.type)) {
      // Operator rule:
      //  • Forwarded sheet = all top-ups + all manual entries (OCR-forwarded by default)
      //  • Not-Forwarded sheet = top-ups explicitly marked forwarded=false
      //    PLUS all manual entries (so manual entries appear in BOTH sheets)
      if (t.type === "client_topup") {
        if (t.topup_forwarded === false) notForwardedIn.push(t);
        else forwardedIn.push(t);
      } else if (MANUAL_TYPES.has(t.type)) {
        forwardedIn.push(t);
        notForwardedIn.push(t);
      }
    }
  }
  return { forwardedIn, notForwardedIn, usdtGiven, withdraws };
}

export type Totals = {
  count: number;
  bdt: number;
  usdt: number;
  bdtFromUsdt: number;
};

export function sumIn(rows: ArchiveTxn[]): Totals {
  let bdt = 0;
  for (const r of rows) bdt += r.bdt_amount;
  return { count: rows.length, bdt, usdt: 0, bdtFromUsdt: 0 };
}

export function sumUsdt(rows: ArchiveTxn[]): Totals {
  let usdt = 0;
  let bdtFromUsdt = 0;
  for (const r of rows) {
    usdt += r.usdt_amount;
    bdtFromUsdt += r.usdt_amount * r.rate;
  }
  return { count: rows.length, bdt: 0, usdt, bdtFromUsdt };
}

export function sumWithdraw(rows: ArchiveTxn[]): Totals {
  let bdt = 0;
  for (const r of rows) bdt += r.bdt_amount;
  return { count: rows.length, bdt, usdt: 0, bdtFromUsdt: 0 };
}

/**
 * Two due/advance numbers:
 *   forwardedOnly: forwarded payments IN (top-ups + manual) − usdt cost − withdraw
 *   all:          forwardedOnly + un-forwarded top-ups (manual entries are NOT
 *                 added again because they already counted in forwardedOnly).
 * Positive = Advance, Negative = Due.
 */
export function computeDueAdvancePair(b: Buckets): {
  forwardedOnly: number;
  all: number;
} {
  const fwdIn = sumIn(b.forwardedIn).bdt;
  // Only client_topup rows are unique to the not-forwarded bucket; manual
  // entries are mirrored from forwardedIn so we exclude them here to avoid
  // double counting.
  const notFwdTopupOnly = b.notForwardedIn
    .filter((t) => t.type === "client_topup")
    .reduce((s, t) => s + t.bdt_amount, 0);
  const usdtCost = sumUsdt(b.usdtGiven).bdtFromUsdt;
  const wd = sumWithdraw(b.withdraws).bdt;
  return {
    forwardedOnly: fwdIn - usdtCost - wd,
    all: fwdIn + notFwdTopupOnly - usdtCost - wd,
  };
}
