// Shared helpers for computing seller Due/Advance balance and forwarding dedupe.
// Used by forward-proof, forward-seller-proof, and any future caller that
// needs the same balance/total-line semantics.

export type Txn = {
  id?: string;
  top_up_request_id?: string | null;
  type: string;
  bdt_amount: number | string | null;
  usdt_amount: number | string | null;
  rate: number | string | null;
  status: string | null;
  created_at: string;
};

/**
 * Compute single global Due/Advance running balance for a seller.
 * Positive = Advance, Negative = Due.
 *  +bdt_amount on bdt_payment / client_topup / tenant_payment
 *  -bdt_amount on withdraw
 *  -(usdt_amount * rate) on usdt_received
 * Only approved entries count.
 */
export function computeDueAdvance(txns: Txn[]): number {
  let running = 0;
  const sorted = [...(txns || [])].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  for (const t of sorted) {
    if ((t.status || 'approved') !== 'approved') continue;
    if (t.type === 'bdt_payment' || t.type === 'client_topup' || t.type === 'tenant_payment') {
      running += Number(t.bdt_amount || 0);
    } else if (t.type === 'withdraw') {
      running -= Number(t.bdt_amount || 0);
    } else if (t.type === 'usdt_received') {
      running -= Number(t.usdt_amount || 0) * Number(t.rate || 0);
    }
  }
  return running;
}

export function formatBdtIN(value: number): string {
  return Math.round(Math.abs(value)).toLocaleString('en-IN');
}

export function buildTotalLine(balance: number): string {
  if (balance > 0) return `\n🟢 Total: Advance +৳${formatBdtIN(balance)}`;
  if (balance < 0) return `\n🔴 Total: Due −৳${formatBdtIN(balance)}`;
  return `\n⚪ Total: ৳0`;
}

/**
 * Fetch ALL seller_transactions for a seller, paginating past the 1000-row
 * default limit. CRITICAL: without this, sellers with >1000 ledger rows get
 * a truncated balance and the Telegram total line is wrong.
 */
export async function fetchAllSellerTxns(supabase: any, sellerId: string): Promise<Txn[]> {
  const PAGE = 1000;
  let from = 0;
  const all: Txn[] = [];
  while (true) {
    const { data, error } = await supabase
      .from('seller_transactions')
      .select('id, type, bdt_amount, usdt_amount, rate, status, created_at, top_up_request_id')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as Txn[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/**
 * Also include any approved top_up_requests that haven't yet been mirrored
 * into seller_transactions (verify-topup runs async — race window). Without
 * this, two near-simultaneous forwards can each miss the other's pending
 * credit and the Telegram total goes BACKWARDS.
 */
export async function fetchPendingTopupCredits(
  supabase: any,
  sellerId: string,
): Promise<Txn[]> {
  // Find bank accounts for this seller
  const { data: banks } = await supabase
    .from('bank_accounts')
    .select('id')
    .eq('seller_id', sellerId);
  const bankIds = (banks || []).map((b: any) => b.id);
  if (bankIds.length === 0) return [];

  const { data: topups } = await supabase
    .from('top_up_requests')
    .select('id, bdt_amount, created_at, status')
    .in('bank_account_id', bankIds)
    .eq('status', 'approved');
  if (!topups || topups.length === 0) return [];

  const ids = topups.map((t: any) => t.id);
  const { data: mirrored } = await supabase
    .from('seller_transactions')
    .select('top_up_request_id')
    .in('top_up_request_id', ids);
  const mirroredSet = new Set((mirrored || []).map((m: any) => m.top_up_request_id));

  // Also exclude top_ups already mirrored into the archive tables. Without
  // this, old (pre-archive) top_ups appear "unmirrored" and get re-credited
  // into the running balance, inflating Telegram totals.
  try {
    const { data: archiveTables } = await supabase
      .from('information_schema.tables' as any)
      .select('table_name')
      .eq('table_schema', 'public')
      .like('table_name', 'seller_transactions_archive_%');
    for (const tbl of (archiveTables || []) as Array<{ table_name: string }>) {
      const { data: archMirrored } = await supabase
        .from(tbl.table_name as any)
        .select('top_up_request_id')
        .in('top_up_request_id', ids);
      for (const m of (archMirrored || []) as any[]) {
        if (m.top_up_request_id) mirroredSet.add(m.top_up_request_id);
      }
    }
  } catch (e) {
    // information_schema may not be exposed via PostgREST; fall back to a
    // hardcoded list of known archive months. Safe no-op if missing.
    const knownArchives = ['seller_transactions_archive_2026_05'];
    for (const tbl of knownArchives) {
      try {
        const { data: archMirrored } = await supabase
          .from(tbl as any)
          .select('top_up_request_id')
          .in('top_up_request_id', ids);
        for (const m of (archMirrored || []) as any[]) {
          if (m.top_up_request_id) mirroredSet.add(m.top_up_request_id);
        }
      } catch { /* archive table absent — ignore */ }
    }
  }

  return topups
    .filter((t: any) => !mirroredSet.has(t.id))
    .map((t: any) => ({
      type: 'client_topup',
      bdt_amount: t.bdt_amount,
      usdt_amount: 0,
      rate: 0,
      status: 'approved',
      created_at: t.created_at,
    }));
}

/**
 * Atomic dedupe check (read-only, legacy). Prefer `claimForwardSlot` for new code
 * because it claims the slot atomically before the Telegram POST.
 */
export async function checkForwardLog(
  supabase: any,
  sourceType: string,
  sourceId: string,
): Promise<{ alreadyForwarded: boolean; messageId: number | null }> {
  const { data } = await supabase
    .from('telegram_forward_log')
    .select('telegram_message_id')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .maybeSingle();
  if (data) return { alreadyForwarded: true, messageId: data.telegram_message_id };
  return { alreadyForwarded: false, messageId: null };
}

/**
 * Atomically reserve the forward slot BEFORE calling Telegram.
 * Returns true if THIS caller won the slot; false if a concurrent caller
 * already claimed (or already completed) it. Race-safe at the SQL level.
 */
export async function claimForwardSlot(
  supabase: any,
  sourceType: string,
  sourceId: string,
  groupId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_forward_slot', {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_group_id: groupId,
  });
  if (error) {
    console.warn('claimForwardSlot RPC failed:', error.message);
    return false; // Fail-closed: don't double-send if we can't claim.
  }
  return data === true;
}

/** Fill in message_id + balance after a successful Telegram POST. */
export async function completeForwardSlot(
  supabase: any,
  sourceType: string,
  sourceId: string,
  messageId: number | null,
  totalBdt: number | null,
): Promise<void> {
  try {
    await supabase.rpc('complete_forward_slot', {
      p_source_type: sourceType,
      p_source_id: sourceId,
      p_message_id: messageId,
      p_caption_total: totalBdt,
    });
  } catch (e) {
    console.warn('completeForwardSlot failed:', (e as any)?.message);
  }
}

/** Release the slot when the Telegram POST itself failed, so a retry can succeed. */
export async function releaseForwardSlot(
  supabase: any,
  sourceType: string,
  sourceId: string,
): Promise<void> {
  try {
    await supabase.rpc('release_forward_slot', {
      p_source_type: sourceType,
      p_source_id: sourceId,
    });
  } catch (e) {
    console.warn('releaseForwardSlot failed:', (e as any)?.message);
  }
}

/** @deprecated Use claimForwardSlot + completeForwardSlot. Kept for back-compat. */
export async function writeForwardLog(
  supabase: any,
  sourceType: string,
  sourceId: string,
  groupId: string,
  messageId: number | null,
  totalBdt: number | null,
): Promise<void> {
  try {
    await supabase.from('telegram_forward_log').insert({
      source_type: sourceType,
      source_id: sourceId,
      telegram_group_id: groupId,
      telegram_message_id: messageId,
      caption_total_bdt: totalBdt,
    });
  } catch (e) {
    console.warn('writeForwardLog: insert failed (likely race):', (e as any)?.message);
  }
}
