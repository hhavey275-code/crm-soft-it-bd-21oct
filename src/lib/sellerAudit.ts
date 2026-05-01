import { supabase } from "@/integrations/supabase/client";
import { computeDueAdvanceRunning } from "@/lib/sellerRunningTotal";

/**
 * Seller accounts audit / reconciliation helpers.
 *
 * Goal: surface mismatches that cause balance drift.
 *
 * 1. Orphan top-ups — approved client top_up_requests whose bdt_amount > 0
 *    and whose bank_account_id maps to a seller, but no corresponding
 *    seller_transactions row of type 'client_topup' exists with that
 *    top_up_request_id. (Money came in but never hit the seller ledger.)
 *
 * 2. Skipped seller_transactions — rows that DO NOT contribute to the
 *    running balance (missing usdt rate, zero bdt_amount, pending status,
 *    etc.). These are dangerous because admin sees them in the table but
 *    they silently don't affect totals.
 *
 * 3. Per-seller current balance — recomputed from raw transactions so
 *    admin can compare against UI display.
 */

export type OrphanTopup = {
  topup_id: string;
  user_id: string;
  user_name: string | null;
  bdt_amount: number;
  amount_usd: number;
  bank_account_id: string;
  bank_name: string | null;
  seller_id: string;
  seller_name: string | null;
  approved_at: string | null;
  created_at: string;
};

export type SkippedSellerTxn = {
  id: string;
  seller_id: string;
  seller_name: string | null;
  type: string;
  bdt_amount: number;
  usdt_amount: number;
  rate: number;
  status: string;
  reason: string;
  created_at: string;
  description: string | null;
};

export type SellerBalanceRow = {
  seller_id: string;
  seller_name: string | null;
  computed_balance_bdt: number;
  txn_count: number;
  approved_topup_count: number;
  client_topup_in_ledger_count: number;
  orphan_topup_count: number;
};

export type AuditReport = {
  generated_at: string;
  orphans: OrphanTopup[];
  skipped: SkippedSellerTxn[];
  balances: SellerBalanceRow[];
  summary: {
    total_orphans: number;
    total_skipped: number;
    sellers_with_issues: number;
  };
};

function reasonForSkip(t: any): string | null {
  const status = (t.status || "approved").toLowerCase();
  if (status !== "approved") return `Status is "${status}" — not counted`;
  if (t.type === "bdt_payment" || t.type === "client_topup" || t.type === "tenant_payment") {
    return Number(t.bdt_amount || 0) === 0 ? "BDT amount is zero" : null;
  }
  if (t.type === "withdraw") {
    return Number(t.bdt_amount || 0) === 0 ? "Withdraw amount is zero" : null;
  }
  if (t.type === "usdt_received") {
    if (Number(t.usdt_amount || 0) === 0) return "USDT amount is zero";
    if (Number(t.rate || 0) <= 0) return "USDT rate is missing or zero";
    return null;
  }
  return `Unknown type: ${t.type || "(blank)"}`;
}

/**
 * Run a full audit. Reads top_up_requests, seller_transactions, bank_accounts,
 * profiles and cross-checks them. Returns a structured report.
 */
export async function runSellerAudit(): Promise<AuditReport> {
  // Pull everything we need in parallel.
  const [
    { data: topups },
    { data: txns },
    { data: banks },
    { data: profiles },
  ] = await Promise.all([
    supabase
      .from("top_up_requests")
      .select("id, user_id, amount, bdt_amount, bank_account_id, status, created_at, reviewed_at")
      .eq("status", "approved")
      .not("bank_account_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("seller_transactions")
      .select("id, seller_id, type, bdt_amount, usdt_amount, rate, status, top_up_request_id, created_at, description")
      .order("created_at", { ascending: false })
      .limit(10000),
    supabase
      .from("bank_accounts")
      .select("id, bank_name, account_number, seller_id"),
    supabase
      .from("profiles")
      .select("user_id, full_name, email"),
  ]);

  const banksById = new Map((banks || []).map((b: any) => [b.id, b]));
  const profileById = new Map((profiles || []).map((p: any) => [p.user_id, p]));

  // Index seller_transactions by top_up_request_id for orphan lookup.
  const txnByTopupId = new Map<string, any>();
  for (const t of txns || []) {
    if (t.top_up_request_id && t.type === "client_topup" && (t.status || "approved") !== "rejected") {
      txnByTopupId.set(t.top_up_request_id, t);
    }
  }

  // Find unique seller_ids present (from txns + banks) to display names.
  const sellerNameById = new Map<string, string | null>();
  for (const t of txns || []) {
    if (t.seller_id && !sellerNameById.has(t.seller_id)) {
      sellerNameById.set(t.seller_id, profileById.get(t.seller_id)?.full_name || profileById.get(t.seller_id)?.email || null);
    }
  }
  for (const b of banks || []) {
    if (b.seller_id && !sellerNameById.has(b.seller_id)) {
      sellerNameById.set(b.seller_id, profileById.get(b.seller_id)?.full_name || profileById.get(b.seller_id)?.email || null);
    }
  }

  // 1. Orphan top-ups
  const orphans: OrphanTopup[] = [];
  for (const tr of topups || []) {
    const bank = banksById.get(tr.bank_account_id) as any;
    if (!bank?.seller_id) continue; // top-up not tied to a seller-owned bank → not an orphan candidate
    if (Number(tr.bdt_amount || 0) === 0) continue; // skip zero-BDT
    const matched = txnByTopupId.get(tr.id);
    if (matched) continue; // already linked
    const profile = profileById.get(tr.user_id) as any;
    orphans.push({
      topup_id: tr.id,
      user_id: tr.user_id,
      user_name: profile?.full_name || profile?.email || null,
      bdt_amount: Number(tr.bdt_amount || 0),
      amount_usd: Number(tr.amount || 0),
      bank_account_id: tr.bank_account_id,
      bank_name: bank?.bank_name || null,
      seller_id: bank.seller_id,
      seller_name: sellerNameById.get(bank.seller_id) || null,
      approved_at: tr.reviewed_at || null,
      created_at: tr.created_at,
    });
  }

  // 2. Skipped seller_transactions
  const skipped: SkippedSellerTxn[] = [];
  for (const t of txns || []) {
    const reason = reasonForSkip(t);
    if (!reason) continue;
    skipped.push({
      id: t.id,
      seller_id: t.seller_id,
      seller_name: sellerNameById.get(t.seller_id) || null,
      type: t.type,
      bdt_amount: Number(t.bdt_amount || 0),
      usdt_amount: Number(t.usdt_amount || 0),
      rate: Number(t.rate || 0),
      status: t.status || "approved",
      reason,
      created_at: t.created_at,
      description: t.description,
    });
  }

  // 3. Per-seller balance (recomputed from raw txns)
  const txnsBySeller = new Map<string, any[]>();
  for (const t of txns || []) {
    if (!txnsBySeller.has(t.seller_id)) txnsBySeller.set(t.seller_id, []);
    txnsBySeller.get(t.seller_id)!.push(t);
  }
  const balances: SellerBalanceRow[] = [];
  const orphanCountBySeller = new Map<string, number>();
  for (const o of orphans) {
    orphanCountBySeller.set(o.seller_id, (orphanCountBySeller.get(o.seller_id) || 0) + 1);
  }
  for (const [sellerId, list] of txnsBySeller.entries()) {
    const running = computeDueAdvanceRunning(list);
    const sorted = [...list].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const last = sorted[sorted.length - 1];
    const computed = last ? running.get(last.id) || 0 : 0;
    balances.push({
      seller_id: sellerId,
      seller_name: sellerNameById.get(sellerId) || null,
      computed_balance_bdt: computed,
      txn_count: list.length,
      approved_topup_count: list.filter((x) => x.type === "client_topup").length,
      client_topup_in_ledger_count: list.filter((x) => x.type === "client_topup" && (x.status || "approved") === "approved").length,
      orphan_topup_count: orphanCountBySeller.get(sellerId) || 0,
    });
  }
  // Make sure sellers that ONLY have orphans (no txns) still appear
  for (const sellerId of orphanCountBySeller.keys()) {
    if (!txnsBySeller.has(sellerId)) {
      balances.push({
        seller_id: sellerId,
        seller_name: sellerNameById.get(sellerId) || null,
        computed_balance_bdt: 0,
        txn_count: 0,
        approved_topup_count: 0,
        client_topup_in_ledger_count: 0,
        orphan_topup_count: orphanCountBySeller.get(sellerId) || 0,
      });
    }
  }
  balances.sort((a, b) => (b.orphan_topup_count - a.orphan_topup_count) || (a.seller_name || "").localeCompare(b.seller_name || ""));

  const sellersWithIssues = new Set<string>();
  orphans.forEach((o) => sellersWithIssues.add(o.seller_id));
  skipped.forEach((s) => sellersWithIssues.add(s.seller_id));

  return {
    generated_at: new Date().toISOString(),
    orphans,
    skipped,
    balances,
    summary: {
      total_orphans: orphans.length,
      total_skipped: skipped.length,
      sellers_with_issues: sellersWithIssues.size,
    },
  };
}

/**
 * Backfill a single orphan top-up by inserting the corresponding
 * client_topup row into seller_transactions. Uses the same shape as the
 * sync_seller_transaction_for_approved_topup trigger would produce.
 */
export async function backfillOrphan(orphan: OrphanTopup, reviewerId: string | null): Promise<void> {
  const { error } = await supabase.from("seller_transactions").insert({
    seller_id: orphan.seller_id,
    type: "client_topup",
    bdt_amount: orphan.bdt_amount,
    usdt_amount: 0,
    rate: 0,
    description: `Audit backfill — Client top-up $${orphan.amount_usd}`,
    bank_account_id: orphan.bank_account_id,
    top_up_request_id: orphan.topup_id,
    created_at: orphan.approved_at || orphan.created_at,
    status: "approved",
    reviewed_by: reviewerId,
    reviewed_at: new Date().toISOString(),
    entry_by_name: orphan.user_name || "Audit Backfill",
  });
  if (error) throw error;
}