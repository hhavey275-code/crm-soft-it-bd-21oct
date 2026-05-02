import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarRange } from "lucide-react";
import {
  formatBdt,
  formatDueAdvance,
  computeTransactionDelta,
  isCountedSellerTransaction,
} from "@/lib/sellerRunningTotal";

type Txn = {
  id: string;
  type: string;
  bdt_amount: number | null;
  usdt_amount: number | null;
  rate: number | null;
  created_at: string;
  status?: string | null;
};

function monthKey(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", timeZone: "UTC" });
}

export function MonthlyDueAdvanceCard({ transactions }: { transactions: Txn[] | undefined }) {
  const rows = useMemo(() => {
    if (!transactions || transactions.length === 0) return [];
    const sorted = [...transactions].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const map = new Map<
      string,
      { inBdt: number; withdrawBdt: number; usdtCostBdt: number; net: number }
    >();
    for (const t of sorted) {
      if (!isCountedSellerTransaction(t)) continue;
      const key = monthKey(t.created_at);
      const cur = map.get(key) || { inBdt: 0, withdrawBdt: 0, usdtCostBdt: 0, net: 0 };
      if (t.type === "bdt_payment" || t.type === "client_topup" || t.type === "tenant_payment") {
        cur.inBdt += Number(t.bdt_amount || 0);
      } else if (t.type === "withdraw") {
        cur.withdrawBdt += Math.abs(Number(t.bdt_amount || 0));
      } else if (t.type === "usdt_received") {
        cur.usdtCostBdt += Math.abs(Number(t.usdt_amount || 0)) * Number(t.rate || 0);
      }
      cur.net += computeTransactionDelta(t);
      map.set(key, cur);
    }
    const keys = Array.from(map.keys()).sort();
    let running = 0;
    return keys.map((k) => {
      const v = map.get(k)!;
      running += v.net;
      return { month: k, ...v, running };
    });
  }, [transactions]);

  if (rows.length === 0) return null;

  const grand = rows[rows.length - 1];
  const grandRunDisp = formatDueAdvance(grand.running);

  const totalIn = rows.reduce((s, r) => s + r.inBdt, 0);
  const totalOut = rows.reduce((s, r) => s + r.withdrawBdt, 0);
  const totalUsdtBdt = rows.reduce((s, r) => s + r.usdtCostBdt, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="h-4 w-4 text-primary" />
          Month-by-Month Due / Advance
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          Final:{" "}
          <span
            className={
              grandRunDisp.isAdvance
                ? "font-bold text-emerald-600 dark:text-emerald-400"
                : grandRunDisp.isZero
                  ? "font-bold text-muted-foreground"
                  : "font-bold text-rose-600 dark:text-rose-400"
            }
          >
            {grandRunDisp.text}
          </span>
        </span>
      </CardHeader>
      <CardContent>
        {/* Desktop / tablet table */}
        <div className="hidden md:block rounded border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Payments IN</TableHead>
                <TableHead className="text-right">Withdraw</TableHead>
                <TableHead className="text-right">USDT cost</TableHead>
                <TableHead className="text-right">Net Δ</TableHead>
                <TableHead className="text-right">Running (Adv/Due)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const netDisp = formatDueAdvance(r.net);
                const runDisp = formatDueAdvance(r.running);
                return (
                  <TableRow key={r.month}>
                    <TableCell className="font-medium">{monthLabel(r.month)}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {r.inBdt > 0 ? formatBdt(r.inBdt) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-600 dark:text-rose-400">
                      {r.withdrawBdt > 0 ? formatBdt(r.withdrawBdt) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.usdtCostBdt > 0 ? formatBdt(r.usdtCostBdt) : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-medium ${
                        netDisp.isAdvance
                          ? "text-emerald-600 dark:text-emerald-400"
                          : netDisp.isZero
                            ? "text-muted-foreground"
                            : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {netDisp.text}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-bold ${
                        runDisp.isAdvance
                          ? "text-emerald-600 dark:text-emerald-400"
                          : runDisp.isZero
                            ? "text-muted-foreground"
                            : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {runDisp.text}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total ({rows.length} months)</TableCell>
                <TableCell className="text-right tabular-nums font-bold">{formatBdt(totalIn)}</TableCell>
                <TableCell className="text-right tabular-nums font-bold text-rose-600 dark:text-rose-400">
                  {formatBdt(totalOut)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-bold">{formatBdt(totalUsdtBdt)}</TableCell>
                <TableCell />
                <TableCell
                  className={`text-right tabular-nums font-extrabold ${
                    grandRunDisp.isAdvance
                      ? "text-emerald-600 dark:text-emerald-400"
                      : grandRunDisp.isZero
                        ? "text-muted-foreground"
                        : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {grandRunDisp.text}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>

        {/* Mobile stacked cards */}
        <div className="md:hidden space-y-2">
          {rows.map((r) => {
            const runDisp = formatDueAdvance(r.running);
            const netDisp = formatDueAdvance(r.net);
            return (
              <div key={r.month} className="rounded-lg border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold">{monthLabel(r.month)}</span>
                  <span
                    className={`text-sm font-bold ${
                      runDisp.isAdvance
                        ? "text-emerald-600 dark:text-emerald-400"
                        : runDisp.isZero
                          ? "text-muted-foreground"
                          : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {runDisp.text}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div>
                    IN:{" "}
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                      {r.inBdt > 0 ? formatBdt(r.inBdt) : "—"}
                    </span>
                  </div>
                  <div>
                    Out:{" "}
                    <span className="font-medium text-rose-600 dark:text-rose-400">
                      {r.withdrawBdt > 0 ? formatBdt(r.withdrawBdt) : "—"}
                    </span>
                  </div>
                  {r.usdtCostBdt > 0 && (
                    <div>
                      USDT: <span className="font-medium">{formatBdt(r.usdtCostBdt)}</span>
                    </div>
                  )}
                  <div className="col-span-2">
                    Net Δ:{" "}
                    <span
                      className={`font-medium ${
                        netDisp.isAdvance
                          ? "text-emerald-600 dark:text-emerald-400"
                          : netDisp.isZero
                            ? "text-muted-foreground"
                            : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {netDisp.text}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
