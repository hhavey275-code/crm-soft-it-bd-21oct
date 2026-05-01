import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { computeDueAdvanceRunning } from "@/lib/sellerRunningTotal";

/**
 * Build a consolidated monthly Excel report covering ALL sellers.
 * One sheet per seller with opening / transactions / closing rows for the
 * selected month (year-month). Designed to back the single-button monthly
 * export on the Audit page.
 */

type Bucket = { year: number; month: number };

function monthLabel(b: Bucket) {
  return new Date(b.year, b.month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

function inBucket(d: Date, b: Bucket) {
  return d.getFullYear() === b.year && d.getMonth() + 1 === b.month;
}

function getTypeLabel(type: string) {
  return type === "usdt_received"
    ? "USDT Given"
    : type === "bdt_payment"
    ? "BDT Payment"
    : type === "withdraw"
    ? "Withdraw"
    : "Client Top-Up";
}

export async function exportAllSellersMonthly(bucket: Bucket): Promise<{ sheets: number; rows: number }> {
  const [{ data: txns }, { data: profiles }, { data: banks }] = await Promise.all([
    supabase
      .from("seller_transactions")
      .select("id, seller_id, type, bdt_amount, usdt_amount, rate, status, created_at, description, bank_account_id, top_up_request_id")
      .order("created_at", { ascending: true })
      .limit(20000),
    supabase.from("profiles").select("user_id, full_name, email"),
    supabase.from("bank_accounts").select("id, bank_name, account_number, account_name"),
  ]);

  const profileById = new Map((profiles || []).map((p: any) => [p.user_id, p]));
  const banksById = new Map((banks || []).map((b: any) => [b.id, b]));

  // Group by seller
  const bySeller = new Map<string, any[]>();
  for (const t of txns || []) {
    if (!bySeller.has(t.seller_id)) bySeller.set(t.seller_id, []);
    bySeller.get(t.seller_id)!.push(t);
  }

  const wb = XLSX.utils.book_new();
  let totalRows = 0;
  let sheetCount = 0;

  // Summary sheet collected as we go
  const summaryRows: any[] = [];

  // Sort sellers by name
  const sellerEntries = [...bySeller.entries()].map(([sid, list]) => {
    const p = profileById.get(sid) as any;
    const name = p?.full_name || p?.email || sid.slice(0, 8);
    return { sellerId: sid, name, list };
  });
  sellerEntries.sort((a, b) => a.name.localeCompare(b.name));

  for (const { sellerId, name, list } of sellerEntries) {
    const monthTxns = list.filter((t: any) => inBucket(new Date(t.created_at), bucket));
    if (monthTxns.length === 0) continue;

    // Opening = running total just before the first transaction in this month
    const allRunning = computeDueAdvanceRunning(list);
    const sortedAll = [...list].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const firstInMonthIdx = sortedAll.findIndex((t) => inBucket(new Date(t.created_at), bucket));
    const opening = firstInMonthIdx > 0 ? allRunning.get(sortedAll[firstInMonthIdx - 1].id) || 0 : 0;

    const sortedMonth = [...monthTxns].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const lastInMonth = sortedMonth[sortedMonth.length - 1];
    const closing = lastInMonth ? allRunning.get(lastInMonth.id) || 0 : opening;

    const rows: any[] = [];
    rows.push({
      Date: "OPENING",
      Type: "",
      Status: "",
      "BDT Amount": "",
      "USDT Amount": "",
      Rate: "",
      Bank: "",
      Description: `Opening Balance — ${monthLabel(bucket)}`,
      "Due/Advance (BDT)": Number(opening.toFixed(2)),
    });
    for (const t of sortedMonth) {
      const bank = banksById.get(t.bank_account_id) as any;
      rows.push({
        Date: new Date(t.created_at).toISOString().slice(0, 16).replace("T", " "),
        Type: getTypeLabel(t.type),
        Status: (t.status || "approved").toUpperCase(),
        "BDT Amount": Number(t.bdt_amount || 0),
        "USDT Amount": Number(t.usdt_amount || 0),
        Rate: Number(t.rate || 0),
        Bank: bank ? `${bank.bank_name} ****${(bank.account_number || "").slice(-4)}` : "—",
        Description: t.description || "",
        "Due/Advance (BDT)": Number((allRunning.get(t.id) || 0).toFixed(2)),
      });
    }
    rows.push({
      Date: "CLOSING",
      Type: "",
      Status: "",
      "BDT Amount": "",
      "USDT Amount": "",
      Rate: "",
      Bank: "",
      Description: closing >= 0 ? `Advance: BDT ${closing.toFixed(2)}` : `Due: BDT ${Math.abs(closing).toFixed(2)}`,
      "Due/Advance (BDT)": Number(closing.toFixed(2)),
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
      { wch: 10 }, { wch: 22 }, { wch: 36 }, { wch: 18 },
    ];
    // Sheet name max 31 chars, no special chars
    const safeName = name.replace(/[\\/?*[\]:]/g, "").slice(0, 28) || sellerId.slice(0, 8);
    XLSX.utils.book_append_sheet(wb, ws, `${safeName}`);

    totalRows += rows.length;
    sheetCount += 1;

    summaryRows.push({
      Seller: name,
      "Opening (BDT)": Number(opening.toFixed(2)),
      "Closing (BDT)": Number(closing.toFixed(2)),
      "Net Change (BDT)": Number((closing - opening).toFixed(2)),
      Transactions: sortedMonth.length,
    });
  }

  if (sheetCount === 0) {
    throw new Error(`No transactions for ${monthLabel(bucket)}`);
  }

  // Insert summary as first sheet
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
  summaryWs["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];
  // Prepend the summary sheet
  const reordered: typeof wb.SheetNames = ["Summary", ...wb.SheetNames];
  wb.Sheets["Summary"] = summaryWs;
  wb.SheetNames = reordered;

  const fname = `all-sellers-${bucket.year}-${String(bucket.month).padStart(2, "0")}.xlsx`;
  XLSX.writeFile(wb, fname);
  return { sheets: sheetCount, rows: totalRows };
}

/**
 * Discover months that have at least one seller_transaction. Newest first.
 */
export async function getAvailableMonths(): Promise<Bucket[]> {
  const { data } = await supabase
    .from("seller_transactions")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(20000);
  const set = new Set<string>();
  for (const r of data || []) {
    const d = new Date(r.created_at);
    set.add(`${d.getFullYear()}-${d.getMonth() + 1}`);
  }
  const list: Bucket[] = [...set].map((s) => {
    const [y, m] = s.split("-").map(Number);
    return { year: y, month: m };
  });
  list.sort((a, b) => (b.year - a.year) || (b.month - a.month));
  if (list.length === 0) {
    const now = new Date();
    list.push({ year: now.getFullYear(), month: now.getMonth() + 1 });
  }
  return list;
}

export { monthLabel };
export type { Bucket };