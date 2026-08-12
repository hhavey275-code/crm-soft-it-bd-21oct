import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Tx = {
  created_at: string;
  type: string;
  amount: number;
  wallet_kind?: string | null;
};

type MonthRow = {
  key: string;
  label: string;
  main: number;
  secondary: number;
  total: number;
};

const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
};

const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function defaultRange(months: number) {
  const now = new Date();
  const end = monthKey(now);
  const start = monthKey(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1));
  return { start, end };
}

export function MonthlyUsageExport({
  transactions,
  secondaryEnabled,
  clientName,
}: {
  transactions?: Tx[] | null;
  secondaryEnabled?: boolean;
  clientName?: string;
}) {
  const [range, setRange] = useState(() => defaultRange(6));

  const rows = useMemo<MonthRow[]>(() => {
    const map = new Map<string, MonthRow>();

    // Pre-fill every month in range so empty months still show up.
    const [sy, sm] = range.start.split("-").map(Number);
    const [ey, em] = range.end.split("-").map(Number);
    if (sy && sm && ey && em) {
      const cursor = new Date(sy, sm - 1, 1);
      const last = new Date(ey, em - 1, 1);
      while (cursor <= last) {
        const k = monthKey(cursor);
        map.set(k, { key: k, label: monthLabel(k), main: 0, secondary: 0, total: 0 });
        cursor.setMonth(cursor.getMonth() + 1);
        if (map.size > 240) break;
      }
    }

    for (const tx of transactions ?? []) {
      // Usage = money that left the wallet into ad accounts, minus refunds back.
      if (tx.type !== "ad_topup" && tx.type !== "refund") continue;
      const k = monthKey(new Date(tx.created_at));
      if (k < range.start || k > range.end) continue;
      const row =
        map.get(k) ?? { key: k, label: monthLabel(k), main: 0, secondary: 0, total: 0 };
      const used = -Number(tx.amount || 0); // ad_topup is negative, refund positive
      if ((tx.wallet_kind ?? "primary") === "secondary") row.secondary += used;
      else row.main += used;
      row.total = row.main + row.secondary;
      map.set(k, row);
    }

    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [transactions, range]);

  const totals = rows.reduce(
    (acc, r) => ({
      main: acc.main + r.main,
      secondary: acc.secondary + r.secondary,
      total: acc.total + r.total,
    }),
    { main: 0, secondary: 0, total: 0 },
  );

  const downloadCsv = () => {
    if (rows.length === 0) {
      toast.error("No months in the selected range");
      return;
    }
    const header = secondaryEnabled
      ? ["Month", "Main Wallet Used (USD)", "Secondary Wallet Used (USD)", "Total Used (USD)"]
      : ["Month", "Main Wallet Used (USD)", "Total Used (USD)"];

    const body = rows.map((r) =>
      secondaryEnabled
        ? [r.label, r.main.toFixed(2), r.secondary.toFixed(2), r.total.toFixed(2)]
        : [r.label, r.main.toFixed(2), r.total.toFixed(2)],
    );

    const totalRow = secondaryEnabled
      ? ["TOTAL", totals.main.toFixed(2), totals.secondary.toFixed(2), totals.total.toFixed(2)]
      : ["TOTAL", totals.main.toFixed(2), totals.total.toFixed(2)];

    const meta = [
      [`Client`, clientName ?? ""],
      [`Period`, `${monthLabel(range.start)} - ${monthLabel(range.end)}`],
      [`Generated`, new Date().toLocaleString()],
      [],
    ];

    const csv = [...meta, header, ...body, [], totalRow]
      .map((line) =>
        line
          .map((cell) => {
            const v = String(cell ?? "");
            return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
          })
          .join(","),
      )
      .join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spend-report_${range.start}_to_${range.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report downloaded");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
        <CardTitle className="text-base md:text-lg">Monthly Spend Report</CardTitle>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 6, 12].map((m) => (
            <Button
              key={m}
              size="sm"
              variant="outline"
              onClick={() => setRange(defaultRange(m))}
            >
              {m}M
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="from-month" className="text-xs">From</Label>
            <Input
              id="from-month"
              type="month"
              value={range.start}
              max={range.end}
              onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to-month" className="text-xs">To</Label>
            <Input
              id="to-month"
              type="month"
              value={range.end}
              min={range.start}
              onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
              className="w-40"
            />
          </div>
          <Button onClick={downloadCsv} className="gap-2">
            <Download className="h-4 w-4" />
            Download CSV
          </Button>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Main Wallet</TableHead>
                {secondaryEnabled && <TableHead className="text-right">Secondary Wallet</TableHead>}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell className="text-right">${money(r.main)}</TableCell>
                  {secondaryEnabled && (
                    <TableCell className="text-right">${money(r.secondary)}</TableCell>
                  )}
                  <TableCell className="text-right font-semibold">${money(r.total)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-bold">TOTAL</TableCell>
                <TableCell className="text-right font-bold">${money(totals.main)}</TableCell>
                {secondaryEnabled && (
                  <TableCell className="text-right font-bold">${money(totals.secondary)}</TableCell>
                )}
                <TableCell className="text-right font-bold">${money(totals.total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
