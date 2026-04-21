/**
 * Compute running cumulative total (BDT) per bank account for seller transactions.
 *
 * Rules:
 * - Only approved (or legacy null/empty status) entries count.
 * - Inflows (bdt_payment, client_topup) and USDT-converted (usdt_amount * rate) ADD to the total of their bank.
 * - Withdrawals SUBTRACT.
 * - Per bank_account_id (rows without a bank are grouped under "__others__").
 * - Computed in chronological order (oldest → newest).
 *
 * Returns a Map<txn_id, running_total>.
 */
export function computeRunningTotalsByBank(transactions: any[]): Map<string, number> {
  const result = new Map<string, number>();
  if (!transactions || transactions.length === 0) return result;

  // Sort ASC by created_at for cumulative calculation
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const bankRunning = new Map<string, number>();

  for (const t of sorted) {
    const status = (t.status || "approved").toLowerCase();
    const bankKey = t.bank_account_id || "__others__";
    const current = bankRunning.get(bankKey) || 0;

    if (status !== "approved") {
      // Pending / rejected don't change running total but still get a snapshot value
      result.set(t.id, current);
      continue;
    }

    let delta = 0;
    if (t.type === "bdt_payment" || t.type === "client_topup") {
      delta = Number(t.bdt_amount || 0);
    } else if (t.type === "usdt_received") {
      // USDT given OUT to client — not a bank inflow; do not affect bank total
      delta = 0;
    } else if (t.type === "withdraw") {
      delta = -Number(t.bdt_amount || 0);
    }

    const next = current + delta;
    bankRunning.set(bankKey, next);
    result.set(t.id, next);
  }

  return result;
}

/** Format BDT in Indian/Bangla grouping: 2,50,000 */
export function formatBdt(value: number): string {
  return `৳${Math.round(value).toLocaleString("en-IN")}`;
}
