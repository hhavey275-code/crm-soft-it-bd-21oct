import { format } from "date-fns";
import * as XLSX from "xlsx";
import XLSXStyle from "xlsx-js-style";
import {
  computeTransactionDelta,
  computeDueAdvanceRunning,
  getSellerTransactionSkipReason,
} from "@/lib/sellerRunningTotal";
import {
  type MonthBucket,
  monthLabel,
  filterMonth,
  aggregateMonth,
  computeLedgerBalanceBefore,
  computeRunningWithOpening,
  getMonthBucket,
} from "@/lib/sellerMonthlyClose";

function getTypeLabel(type: string) {
  return type === "usdt_received"
    ? "USDT Given"
    : type === "bdt_payment"
    ? "BDT Payment"
    : type === "withdraw"
    ? "Withdraw"
    : "Client Top-Up";
}

function extractTrxId(desc: string | null | undefined): string {
  if (!desc) return "";
  const m1 = desc.match(/Tr[xn]\s*ID\s*[:\-]?\s*([A-Za-z0-9]+)/i);
  if (m1) return m1[1];
  const m2 = desc.match(/\b(\d{8,})\b/);
  if (m2) return m2[1];
  return desc.trim();
}

function sortAsc(txns: any[]) {
  return [...(txns || [])].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
}

/** All-columns full-ledger export. One sheet, every column. */
export function exportAllColumnsTotal(
  txns: any[],
  sellerSlug: string,
  filename?: string,
) {
  if (!txns || !txns.length) throw new Error("No transactions to export");
  const sorted = sortAsc(txns);
  const running = computeDueAdvanceRunning(sorted);
  const rows = sorted.map((t: any) => {
    const convBdt = Math.abs(Number(t.usdt_amount || 0)) * Number(t.rate || 0);
    const skipReason = getSellerTransactionSkipReason(t) || "";
    return {
      "Date": format(new Date(t.created_at), "yyyy-MM-dd HH:mm"),
      "Month": monthLabel(getMonthBucket(t.created_at)),
      "Type": getTypeLabel(t.type),
      "Status": (t.status || "approved").toUpperCase(),
      "Transaction ID": (t.top_up_requests?.payment_reference || extractTrxId(t.description)),
      "BDT Amount": Number(t.bdt_amount || 0),
      "USDT Amount": Number(t.usdt_amount || 0),
      "Rate": Number(t.rate || 0),
      "Converted (BDT)": Number(convBdt.toFixed(2)),
      "Bank": t.bank_accounts ? `${t.bank_accounts.bank_name} ****${(t.bank_accounts.account_number || "").slice(-4)}` : "—",
      "Account Name": t.bank_accounts?.account_name || "",
      "Change (BDT)": Number(computeTransactionDelta(t).toFixed(2)),
      "Due/Advance (BDT)": Number((running.get(t.id) || 0).toFixed(2)),
      "Description": t.description || "",
      "Proof URL": t.proof_url || "",
      "Not Calculated Reason": skipReason,
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 18 },
    { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 16 }, { wch: 22 },
    { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 32 }, { wch: 36 }, { wch: 24 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transactions");
  const fname = filename || `${sellerSlug}-ledger-${format(new Date(), "yyyy-MM-dd-HHmm")}.xlsx`;
  XLSX.writeFile(wb, fname);
}

/** Build a colorful styled sheet for a single month, in the user-approved design:
 *  Row1: header (blue + yellow for last cell)
 *  Row2: Final balance in F2
 *  Row3: sub-labels "Total usdt", "total Taka"
 *  Row4: red totals
 *  Row5: previous month closing balance (yellow)
 *  Row6+: transactions with running due/adv
 */
function buildColorfulMonthSheet(allTxns: any[], bucket: MonthBucket) {
  const monthTxns = filterMonth(allTxns, bucket);
  const opening = computeLedgerBalanceBefore(allTxns, bucket);
  const agg = aggregateMonth(allTxns, bucket);
  const closing = opening + agg.delta;
  const sorted = sortAsc(monthTxns);

  const totalPayment = agg.bdtIn + agg.clientBdt;
  const totalUsdt = agg.usdtGiven;
  const totalConvertedBdt = agg.convertedBdt;

  const border = {
    top: { style: "thin", color: { rgb: "999999" } },
    bottom: { style: "thin", color: { rgb: "999999" } },
    left: { style: "thin", color: { rgb: "999999" } },
    right: { style: "thin", color: { rgb: "999999" } },
  };
  const headerStyle = {
    font: { bold: true, sz: 12, color: { rgb: "000000" } },
    fill: { fgColor: { rgb: "D9E1F2" } },
    alignment: { horizontal: "center", vertical: "center" },
    border,
  };
  const headerYellow = {
    ...headerStyle,
    font: { bold: true, sz: 12, color: { rgb: "1F4E78" } },
    fill: { fgColor: { rgb: "FFFF00" } },
  };
  const subLabelStyle = {
    font: { italic: true, sz: 10, color: { rgb: "555555" } },
    alignment: { horizontal: "center" },
  };
  const totalRedStyle = {
    font: { bold: true, sz: 12, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "C00000" } },
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: '#,##0.00',
    border,
  };
  const finalBalanceStyle = {
    font: { bold: true, sz: 14, color: { rgb: "000000" } },
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: '#,##0.00',
  };
  const openingYellowStyle = {
    font: { bold: true, sz: 11, color: { rgb: "000000" } },
    fill: { fgColor: { rgb: "FFFF00" } },
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: '#,##0.00',
    border,
  };
  const openingLabelStyle = {
    font: { bold: true, sz: 11, color: { rgb: "000000" } },
    alignment: { horizontal: "left", vertical: "center" },
    border,
  };
  const dataNumStyle = {
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: '#,##0.00',
    border,
  };
  const dataTextStyle = {
    alignment: { horizontal: "left", vertical: "center" },
    border,
  };

  const aoa: any[][] = [];
  aoa.push(["date and time", "payment", "usdt", "Rate", "Conveted BDT", "total due/adv"]);
  aoa.push(["", "", "", "", "", closing]);
  aoa.push(["", "", "Total usdt", "", "total Taka", ""]);
  aoa.push(["", totalPayment, totalUsdt, "", totalConvertedBdt, ""]);
  aoa.push(["previous month closing balance", opening, "", "", "", ""]);

  const running = computeRunningWithOpening(sorted, opening);
  for (const t of sorted) {
    const isApproved = (t.status || "approved").toLowerCase() === "approved";
    const dt = format(new Date(t.created_at), "dd MMM hh:mm a").toLowerCase();
    let payment: any = "";
    let usdt: any = "";
    let rate: any = "";
    let convBdt: any = "";
    if (t.type === "bdt_payment" || t.type === "client_topup" || t.type === "tenant_payment") {
      payment = Number(t.bdt_amount || 0);
    } else if (t.type === "usdt_received") {
      usdt = Number(t.usdt_amount || 0);
      rate = Number(t.rate || 0);
      convBdt = Math.abs(Number(t.usdt_amount || 0)) * Number(t.rate || 0);
    } else if (t.type === "withdraw") {
      payment = -Math.abs(Number(t.bdt_amount || 0));
    }
    const runVal = isApproved ? Number((running.get(t.id) || 0).toFixed(2)) : "";
    aoa.push([dt, payment, usdt, rate, convBdt, runVal]);
  }

  const ws: any = XLSXStyle.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 28 }, { wch: 18 }, { wch: 14 }, { wch: 8 }, { wch: 16 }, { wch: 18 },
  ];
  ws["!rows"] = [
    { hpt: 28 }, { hpt: 24 }, { hpt: 18 }, { hpt: 24 }, { hpt: 22 },
  ];
  const setStyle = (addr: string, style: any) => {
    if (!ws[addr]) ws[addr] = { t: "s", v: "" };
    ws[addr].s = style;
  };
  ["A1", "B1", "C1", "D1", "E1"].forEach((a) => setStyle(a, headerStyle));
  setStyle("F1", headerYellow);
  setStyle("F2", finalBalanceStyle);
  setStyle("C3", subLabelStyle);
  setStyle("E3", subLabelStyle);
  ["B4", "C4", "E4"].forEach((a) => setStyle(a, totalRedStyle));
  setStyle("A5", openingLabelStyle);
  setStyle("B5", openingYellowStyle);
  ["C5", "D5", "E5", "F5"].forEach((a) => setStyle(a, { fill: { fgColor: { rgb: "FFFF00" } }, border }));
  for (let i = 0; i < sorted.length; i++) {
    const r = 6 + i;
    setStyle(`A${r}`, dataTextStyle);
    ["B", "C", "D", "E", "F"].forEach((col) => setStyle(`${col}${r}`, dataNumStyle));
  }
  const lastRow = 5 + sorted.length;
  ws["!ref"] = `A1:F${Math.max(lastRow, 5)}`;
  return { ws, rowCount: sorted.length };
}

/** Colorful monthly export — one sheet per bucket. */
export function exportColorfulMonthly(
  allTxns: any[],
  sellerSlug: string,
  buckets: MonthBucket[],
) {
  if (!buckets.length) throw new Error("No months to export");
  const wb = XLSXStyle.utils.book_new();
  let total = 0;
  for (const b of buckets) {
    const { ws, rowCount } = buildColorfulMonthSheet(allTxns || [], b);
    if (rowCount === 0 && buckets.length > 1) continue; // skip empty months when bulk-exporting
    XLSXStyle.utils.book_append_sheet(wb, ws, `${b.year}-${String(b.month).padStart(2, "0")}`);
    total += rowCount;
  }
  if (!wb.SheetNames.length) {
    // ensure at least one (selected) month exists in workbook
    const { ws } = buildColorfulMonthSheet(allTxns || [], buckets[0]);
    XLSXStyle.utils.book_append_sheet(wb, ws, `${buckets[0].year}-${String(buckets[0].month).padStart(2, "0")}`);
  }
  const suffix = buckets.length > 1
    ? "month-by-month"
    : `${buckets[0].year}-${String(buckets[0].month).padStart(2, "0")}`;
  XLSXStyle.writeFile(wb, `${sellerSlug}-${suffix}-ledger.xlsx`);
  return total;
}

export function buildAvailableMonths(txns: any[]): MonthBucket[] {
  const set = new Set<string>();
  for (const t of txns || []) {
    const b = getMonthBucket(t.created_at);
    set.add(`${b.year}-${b.month}`);
  }
  if (set.size === 0) {
    const now = new Date();
    return [{ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }];
  }
  return Array.from(set)
    .map((s) => {
      const [y, m] = s.split("-").map(Number);
      return { year: y, month: m };
    })
    .sort((a, b) => (b.year - a.year) || (b.month - a.month));
}

export function slugifySeller(name: string | null | undefined): string {
  return (name || "seller").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}
