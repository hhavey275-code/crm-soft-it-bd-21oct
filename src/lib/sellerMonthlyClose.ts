import { supabase } from "@/integrations/supabase/client";

export type MonthBucket = { year: number; month: number };

export type MonthlyClosing = {
  id: string;
  seller_id: string;
  year: number;
  month: number;
  opening_due_advance_bdt: number;
  month_bdt_in: number;
  month_client_bdt: number;
  month_usdt_given: number;
  month_converted_bdt: number;
  month_withdraw_bdt: number;
  closing_due_advance_bdt: number;
  is_locked: boolean;
  closed_at: string;
  closed_by: string | null;
  note: string | null;
};

export type MonthAggregate = {
  bdtIn: number;       // bdt_payment + tenant_payment
  clientBdt: number;   // client_topup
  usdtGiven: number;
  convertedBdt: number; // usdt_amount * rate
  withdrawBdt: number;
  delta: number;       // signed change to balance
};

export function getMonthBucket(date: Date | string): MonthBucket {
  // Use UTC so a transaction's month bucket doesn't shift across the local
  // timezone boundary (a row at 2026-04-30 23:30 UTC must stay in April even
  // when the browser is in a +06:00 (BD) timezone).
  const d = typeof date === "string" ? new Date(date) : date;
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function isSameMonth(a: { year: number; month: number }, b: { year: number; month: number }) {
  return a.year === b.year && a.month === b.month;
}

export function prevMonth({ year, month }: MonthBucket): MonthBucket {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

export function monthLabel({ year, month }: MonthBucket): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

/** Aggregate seller transactions for a single month (approved only). */
export function aggregateMonth(txns: any[], bucket: MonthBucket): MonthAggregate {
  const acc: MonthAggregate = {
    bdtIn: 0, clientBdt: 0, usdtGiven: 0, convertedBdt: 0, withdrawBdt: 0, delta: 0,
  };
  for (const t of txns) {
    const status = (t.status || "approved").toLowerCase();
    if (status !== "approved") continue;
    const b = getMonthBucket(t.created_at);
    if (!isSameMonth(b, bucket)) continue;
    if (t.type === "bdt_payment" || t.type === "tenant_payment") acc.bdtIn += Number(t.bdt_amount || 0);
    else if (t.type === "client_topup") acc.clientBdt += Number(t.bdt_amount || 0);
    else if (t.type === "usdt_received") {
      acc.usdtGiven += Number(t.usdt_amount || 0);
      acc.convertedBdt += Number(t.usdt_amount || 0) * Number(t.rate || 0);
    } else if (t.type === "withdraw") acc.withdrawBdt += Number(t.bdt_amount || 0);
  }
  acc.delta = acc.bdtIn + acc.clientBdt - acc.convertedBdt - acc.withdrawBdt;
  return acc;
}

/** Filter transactions to a single month bucket. */
export function filterMonth(txns: any[], bucket: MonthBucket): any[] {
  return (txns || []).filter((t) => isSameMonth(getMonthBucket(t.created_at), bucket));
}

/** Compute per-row running balance starting from an opening balance. Pass txns ALREADY filtered to month. */
export function computeRunningWithOpening(monthTxns: any[], opening: number): Map<string, number> {
  const result = new Map<string, number>();
  if (!monthTxns || monthTxns.length === 0) return result;
  const sorted = [...monthTxns].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
  let running = opening;
  for (const t of sorted) {
    const status = (t.status || "approved").toLowerCase();
    if (status !== "approved") {
      result.set(t.id, running);
      continue;
    }
    if (t.type === "bdt_payment" || t.type === "client_topup" || t.type === "tenant_payment") {
      running += Number(t.bdt_amount || 0);
    } else if (t.type === "usdt_received") {
      running -= Number(t.usdt_amount || 0) * Number(t.rate || 0);
    } else if (t.type === "withdraw") {
      running -= Number(t.bdt_amount || 0);
    }
    result.set(t.id, running);
  }
  return result;
}

/** Fetch the closing record (if any) for a given seller & month. */
export async function getMonthlyClosing(sellerId: string, bucket: MonthBucket): Promise<MonthlyClosing | null> {
  const { data } = await (supabase as any)
    .from("seller_monthly_closings")
    .select("*")
    .eq("seller_id", sellerId)
    .eq("year", bucket.year)
    .eq("month", bucket.month)
    .maybeSingle();
  return (data as MonthlyClosing) ?? null;
}

/** Fetch all closings for a seller (descending). */
export async function listClosings(sellerId: string): Promise<MonthlyClosing[]> {
  const { data } = await (supabase as any)
    .from("seller_monthly_closings")
    .select("*")
    .eq("seller_id", sellerId)
    .order("year", { ascending: false })
    .order("month", { ascending: false });
  return (data as MonthlyClosing[]) ?? [];
}

/** Resolve opening balance for the given month: previous month's closing, or 0. */
export async function getOpeningFor(sellerId: string, bucket: MonthBucket): Promise<number> {
  const prev = prevMonth(bucket);
  const rec = await getMonthlyClosing(sellerId, prev);
  return rec ? Number(rec.closing_due_advance_bdt || 0) : 0;
}

/** Close (or re-close) a month: aggregate, compute closing, upsert row. */
export async function closeMonth(params: {
  sellerId: string;
  bucket: MonthBucket;
  txns: any[];
  closedBy: string | null;
  note?: string;
}): Promise<MonthlyClosing> {
  const { sellerId, bucket, txns, closedBy, note } = params;
  const opening = await getOpeningFor(sellerId, bucket);
  const agg = aggregateMonth(txns, bucket);
  const closing = opening + agg.delta;

  const existing = await getMonthlyClosing(sellerId, bucket);
  const payload: any = {
    seller_id: sellerId,
    year: bucket.year,
    month: bucket.month,
    opening_due_advance_bdt: opening,
    month_bdt_in: agg.bdtIn,
    month_client_bdt: agg.clientBdt,
    month_usdt_given: agg.usdtGiven,
    month_converted_bdt: agg.convertedBdt,
    month_withdraw_bdt: agg.withdrawBdt,
    closing_due_advance_bdt: closing,
    is_locked: true,
    closed_at: new Date().toISOString(),
    closed_by: closedBy,
    note: note ?? null,
  };

  if (existing) {
    const { data, error } = await (supabase as any)
      .from("seller_monthly_closings")
      .update(payload)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return data as MonthlyClosing;
  }
  const { data, error } = await (supabase as any)
    .from("seller_monthly_closings")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as MonthlyClosing;
}

export async function reopenMonth(closingId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from("seller_monthly_closings")
    .delete()
    .eq("id", closingId);
  if (error) throw error;
}
