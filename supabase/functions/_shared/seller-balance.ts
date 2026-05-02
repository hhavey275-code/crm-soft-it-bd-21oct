// Shared helpers for computing seller Due/Advance balance and forwarding dedupe.
// Used by forward-proof, forward-seller-proof, and any future caller that
// needs the same balance/total-line semantics.

export type Txn = {
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
  const sorted = [...(txns || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
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
      .select('type, bdt_amount, usdt_amount, rate, status, created_at')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: true })
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
 * Atomic dedupe via telegram_forward_log. Returns the existing message_id
 * if this source was already forwarded, or null if forwarding should proceed.
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
    // Unique violation = someone else logged it first; that's fine.
    console.warn('writeForwardLog: insert failed (likely race):', (e as any)?.message);
  }
}
