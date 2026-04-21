/**
 * Seller running balance helpers.
 *
 * computeRunningTotalsByBank — legacy per-bank cash-in running total (kept for back-compat).
 *
 * computeDueAdvanceRunning — single global running Due/Advance balance per seller (new):
 *   - Money received (BDT payments / client top-ups) ADDS to the running balance.
 *   - USDT given to the client (cost in BDT = usdt_amount * rate) SUBTRACTS.
 *   - Withdrawals SUBTRACT.
 *   - Pending / rejected entries do not change the balance but get a snapshot of the prior value.
 *
 *   Result: positive => Advance (seller has received more than owed),
 *           negative => Due  (seller owes / needs to pay more).
 */

export function computeRunningTotalsByBank(transactions: any[]): Map<string, number> {
  const result = new Map<string, number>();
  if (!transactions || transactions.length === 0) return result;

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const bankRunning = new Map<string, number>();

  for (const t of sorted) {
    const status = (t.status || "approved").toLowerCase();
    const bankKey = t.bank_account_id || "__others__";
    const current = bankRunning.get(bankKey) || 0;

    if (status !== "approved") {
      result.set(t.id, current);
      continue;
    }

    let delta = 0;
    if (t.type === "bdt_payment" || t.type === "client_topup") {
      delta = Number(t.bdt_amount || 0);
    } else if (t.type === "usdt_received") {
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

/**
 * Single global running Due/Advance balance per seller.
 * Positive = Advance, Negative = Due.
 */
export function computeDueAdvanceRunning(transactions: any[]): Map<string, number> {
  const result = new Map<string, number>();
  if (!transactions || transactions.length === 0) return result;

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  let running = 0;

  for (const t of sorted) {
    const status = (t.status || "approved").toLowerCase();

    if (status !== "approved") {
      result.set(t.id, running);
      continue;
    }

    if (t.type === "bdt_payment" || t.type === "client_topup") {
      running += Number(t.bdt_amount || 0);
    } else if (t.type === "usdt_received") {
      // USDT given to client — convert to BDT cost and subtract
      running -= Number(t.usdt_amount || 0) * Number(t.rate || 0);
    } else if (t.type === "withdraw") {
      running -= Number(t.bdt_amount || 0);
    }

    result.set(t.id, running);
  }

  return result;
}

/** Format BDT in Indian/Bangla grouping: 2,50,000 */
export function formatBdt(value: number): string {
  return `৳${Math.round(value).toLocaleString("en-IN")}`;
}

/**
 * Compute the signed BDT delta a single transaction applies to the seller's
 * running Due/Advance balance (positive = balance goes up = more Advance,
 * negative = balance goes down = more Due).
 *   bdt_payment / client_topup → +bdt_amount
 *   withdraw                   → −bdt_amount
 *   usdt_received              → −(usdt_amount × rate)
 * Pending / rejected entries return 0.
 */
export function computeTransactionDelta(t: any): number {
  if (!t) return 0;
  const status = (t.status || "approved").toLowerCase();
  if (status !== "approved") return 0;
  if (t.type === "bdt_payment" || t.type === "client_topup") {
    return Number(t.bdt_amount || 0);
  }
  if (t.type === "withdraw") {
    return -Number(t.bdt_amount || 0);
  }
  if (t.type === "usdt_received") {
    return -(Number(t.usdt_amount || 0) * Number(t.rate || 0));
  }
  return 0;
}

/** Format a signed BDT delta with explicit + or − sign for "this row contributed" display. */
export function formatSignedBdt(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "৳0";
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}৳${Math.abs(rounded).toLocaleString("en-IN")}`;
}

/**
 * Format a Due/Advance signed value for display.
 * Returns: { text, isAdvance } — caller picks color.
 *   Advance (positive)  => "+৳47,00,000"
 *   Due     (negative)  => "−৳47,00,000"
 *   Zero               => "৳0"
 */
export function formatDueAdvance(value: number): { text: string; isAdvance: boolean; isZero: boolean } {
  const rounded = Math.round(value);
  if (rounded === 0) return { text: "৳0", isAdvance: false, isZero: true };
  if (rounded > 0) {
    return { text: `+৳${rounded.toLocaleString("en-IN")}`, isAdvance: true, isZero: false };
  }
  return { text: `−৳${Math.abs(rounded).toLocaleString("en-IN")}`, isAdvance: false, isZero: false };
}
