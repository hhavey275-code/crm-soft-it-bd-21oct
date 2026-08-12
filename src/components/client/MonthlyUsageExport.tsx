import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  reference_id?: string | null;
  description?: string | null;
};

type MonthRow = {
  key: string;
  label: string;
  main: number;
  secondary: number;
  total: number;
};

type DetailRow = {
  monthKey: string;
  monthLabel: string;
  date: string;
  account: string;
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

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

function defaultRange(months: number) {
  const now = new Date();
  const end = monthKey(now);
  const start = monthKey(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1));
  return { start, end };
}

export function MonthlyUsageExport({
  transactions,
  adAccounts,
  secondaryEnabled,
  clientName,
}: {
  transactions?: Tx[] | null;
  adAccounts?: any[] | null;
  secondaryEnabled?: boolean;
  clientName?: string;
}) {
  const [range, setRange] = useState(() => defaultRange(6));
  const [view, setView] = useState<"detail" | "summary">("detail");

  const accountNameOf = (tx: Tx) => {
    const linked = tx.reference_id
      ? adAccounts?.find((a: any) => a.id === tx.reference_id)
      : null;
    return (
      linked?.account_name ||
      String(tx.description || "").split("\n")[0] ||
      "—"
    );
  };

  const inRange = (tx: Tx) => {
    if (tx.type !== "ad_topup" && tx.type !== "refund") return false;
    const k = monthKey(new Date(tx.created_at));
    return k >= range.start && k <= range.end;
  };

  const detailRows = useMemo<DetailRow[]>(() => {
    return (transactions ?? [])
      .filter(inRange)
      .map((tx) => {
        const k = monthKey(new Date(tx.created_at));
        const used = -Number(tx.amount || 0); // ad_topup negative, refund positive
        const isSecondary = (tx.wallet_kind ?? "primary") === "secondary";
        return {
          monthKey: k,
          monthLabel: monthLabel(k),
          date: dateLabel(tx.created_at),
          account: accountNameOf(tx),
          main: isSecondary ? 0 : used,
          secondary: isSecondary ? used : 0,
          total: used,
        };
      })
      .sort((a, b) => (a.monthKey + a.date).localeCompare(b.monthKey + b.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, adAccounts, range]);

  const rows = useMemo<MonthRow[]>(() => {
    const map = new Map<string, MonthRow>();
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
    for (const d of detailRows) {
      const row =
        map.get(d.monthKey) ??
        { key: d.monthKey, label: d.monthLabel, main: 0, secondary: 0, total: 0 };
      row.main += d.main;
      row.secondary += d.secondary;
      row.total = row.main + row.secondary;
      map.set(d.monthKey, row);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [detailRows, range]);

  const totals = rows.reduce(
    (acc, r) => ({
      main: acc.main + r.main,
      secondary: acc.secondary + r.secondary,
      total: acc.total + r.total,
    }),
    { main: 0, secondary: 0, total: 0 },
  );

  const toCsv = (lines: (string | number)[][]) =>
    lines
      .map((line) =>
        line
          .map((cell) => {
            const v = String(cell ?? "");
            return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
          })
          .join(","),
      )
      .join("\n");

  const save = (csv: string, name: string) => {
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report downloaded");
  };

  const meta: (string | number)[][] = [
    ["Client", clientName ?? ""],
    ["Period", `${monthLabel(range.start)} - ${monthLabel(range.end)}`],
    ["Generated", new Date().toLocaleString()],
    [],
  ];

  const header = secondaryEnabled
    ? ["Main Wallet (USD)", "Secondary Wallet (USD)", "Total (USD)"]
    : ["Main Wallet (USD)", "Total (USD)"];

  const amounts = (r: { main: number; secondary: number; total: number }) =>
    secondaryEnabled
      ? [r.main.toFixed(2), r.secondary.toFixed(2), r.total.toFixed(2)]
      : [r.main.toFixed(2), r.total.toFixed(2)];

  const downloadDetail = () => {
    if (detailRows.length === 0) {
      toast.error("No transactions in the selected range");
      return;
    }
    const lines: (string | number)[][] = [...meta, ["Date", "Ad Account", ...header]];
    let current = "";
    let sub = { main: 0, secondary: 0, total: 0 };
    const flush = () => {
      if (!current) return;
      lines.push([`${current} TOTAL`, "", ...amounts(sub)]);
      lines.push([]);
    };
    for (const d of detailRows) {
      if (d.monthLabel !== current) {
        flush();
        current = d.monthLabel;
        sub = { main: 0, secondary: 0, total: 0 };
        lines.push([current, "", ...header.map(() => "")]);
      }
      lines.push([d.date, d.account, ...amounts(d)]);
      sub.main += d.main;
      sub.secondary += d.secondary;
      sub.total += d.total;
    }
    flush();
    lines.push(["GRAND TOTAL", "", ...amounts(totals)]);
    save(toCsv(lines), `spend-report-detail_${range.start}_to_${range.end}.csv`);
  };

  const downloadSummary = () => {
    if (rows.length === 0) {
      toast.error("No months in the selected range");
      return;
    }
    const lines: (string | number)[][] = [
      ...meta,
      ["Month", ...header],
      ...rows.map((r) => [r.label, ...amounts(r)]),
      [],
      ["TOTAL", ...amounts(totals)],
    ];
    save(toCsv(lines), `spend-report-monthly_${range.start}_to_${range.end}.csv`);
  };

  const colCount = secondaryEnabled ? 5 : 4;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
        <CardTitle className="text-base md:text-lg">Spend Report</CardTitle>
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
          <Button onClick={downloadDetail} className="gap-2">
            <Download className="h-4 w-4" />
            Detailed CSV
          </Button>
          <Button onClick={downloadSummary} variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Monthly Summary CSV
          </Button>
        </div>

        <Tabs value={view} onValueChange={(v) => setView(v as any)}>
          <TabsList>
            <TabsTrigger value="detail">Ad account wise</TabsTrigger>
            <TabsTrigger value="summary">Monthly summary</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {view === "detail" ? (
                  <>
                    <TableHead>Date</TableHead>
                    <TableHead>Ad Account</TableHead>
                  </>
                ) : (
                  <TableHead>Month</TableHead>
                )}
                <TableHead className="text-right">Main Wallet</TableHead>
                {secondaryEnabled && (
                  <TableHead className="text-right">Secondary Wallet</TableHead>
                )}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view === "detail" ? (
                <>
                  {detailRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={colCount} className="text-center text-muted-foreground">
                        No transactions in this period
                      </TableCell>
                    </TableRow>
                  )}
                  {detailRows.map((d, i) => {
                    const newMonth = i === 0 || detailRows[i - 1].monthKey !== d.monthKey;
                    return (
                      <>
                        {newMonth && (
                          <TableRow key={`m-${d.monthKey}`} className="bg-muted/50">
                            <TableCell colSpan={colCount} className="font-semibold">
                              {d.monthLabel}
                            </TableCell>
                          </TableRow>
                        )}
                        <TableRow key={`${d.monthKey}-${i}`}>
                          <TableCell className="whitespace-nowrap">{d.date}</TableCell>
                          <TableCell className="font-medium">{d.account}</TableCell>
                          <TableCell className="text-right">
                            {d.main ? `$${money(d.main)}` : "—"}
                          </TableCell>
                          {secondaryEnabled && (
                            <TableCell className="text-right">
                              {d.secondary ? `$${money(d.secondary)}` : "—"}
                            </TableCell>
                          )}
                          <TableCell className="text-right font-semibold">
                            ${money(d.total)}
                          </TableCell>
                        </TableRow>
                      </>
                    );
                  })}
                </>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right">${money(r.main)}</TableCell>
                    {secondaryEnabled && (
                      <TableCell className="text-right">${money(r.secondary)}</TableCell>
                    )}
                    <TableCell className="text-right font-semibold">${money(r.total)}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow>
                <TableCell className="font-bold" colSpan={view === "detail" ? 2 : 1}>
                  GRAND TOTAL
                </TableCell>
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
