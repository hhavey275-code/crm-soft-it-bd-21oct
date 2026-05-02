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
      topup_forwarded: tu ? Boolean(tu.telegram_forwarded) : null,
      topup_amount_usd: tu ? Number(tu.amount || 0) : null,
      topup_telegram_message_id: null,
    };
  });

  return { txns, topupRequests: archivePeriodTopupsRes.data || [] };
}

export type Buckets = {
  forwardedIn: ArchiveTxn[]; // payments IN that we know were forwarded
  notForwardedIn: ArchiveTxn[]; // payments IN that we know were NOT forwarded (or unknown / manual)
  usdtGiven: ArchiveTxn[];
  withdraws: ArchiveTxn[];
};

const IN_TYPES = new Set(["bdt_payment", "client_topup", "tenant_payment"]);

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
      // Per operator rule: all top-ups AND all manual entries (bdt_payment /
      // tenant_payment) were OCR-forwarded, so treat every approved IN row as
      // "forwarded". The notForwardedIn bucket is kept only for client_topup
      // rows whose linked top_up_request explicitly says forwarded=false.
      if (t.type === "client_topup" && t.topup_forwarded === false) {
        notForwardedIn.push(t);
      } else {
        forwardedIn.push(t);
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
 *   forwardedOnly: forwarded payments IN − usdt cost − withdraw
 *   all:          (forwarded + not-forwarded) payments IN − usdt cost − withdraw
 * Positive = Advance, Negative = Due.
 */
export function computeDueAdvancePair(b: Buckets): {
  forwardedOnly: number;
  all: number;
} {
  const fwdIn = sumIn(b.forwardedIn).bdt;
  const notFwdIn = sumIn(b.notForwardedIn).bdt;
  const usdtCost = sumUsdt(b.usdtGiven).bdtFromUsdt;
  const wd = sumWithdraw(b.withdraws).bdt;
  return {
    forwardedOnly: fwdIn - usdtCost - wd,
    all: fwdIn + notFwdIn - usdtCost - wd,
  };
}
