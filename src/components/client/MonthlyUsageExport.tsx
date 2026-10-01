import { Fragment, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarIcon, ChevronDown, ChevronUp, Download } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

type Sums = { topup: number; withdraw: number; net: number };
type MonthRow = Sums & { key: string; label: string };
type AccountRow = Sums & { monthKey: string; monthLabel: string; account: string; count: number };

const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function presetDates(months: number) {
  const now = new Date();
  // Anchor to the last completed month so "1M" = previous month only (e.g. September in October).
  return {
    from: new Date(now.getFullYear(), now.getMonth() - months, 1),
    to: new Date(now.getFullYear(), now.getMonth() - 1, 1),
  };
}

const zero = (): Sums => ({ topup: 0, withdraw: 0, net: 0 });

export function MonthlyUsageExport({
  transactions,
  adAccounts,
  clientName,
}: {
  transactions?: Tx[] | null;
  adAccounts?: any[] | null;
  secondaryEnabled?: boolean;
  clientName?: string;
}) {
  const [range, setRange] = useState(() => defaultRange(1));
  const [view, setView] = useState<"detail" | "summary">("detail");
  const [expanded, setExpanded] = useState(false);

  const accountNameOf = (tx: Tx) => {
    const linked = tx.reference_id ? adAccounts?.find((a: any) => a.id === tx.reference_id) : null;
    if (linked) {
      const id = String(linked.account_id || "").replace(/^act_/, "");
      return id ? `${linked.account_name} (${id})` : linked.account_name;
    }
    return String(tx.description || "").split("\n")[0] || "—";
  };

  const accountRows = useMemo<AccountRow[]>(() => {
    const map = new Map<string, AccountRow>();
    for (const tx of transactions ?? []) {
      if (tx.type !== "ad_topup" && tx.type !== "refund") continue;
      const k = monthKey(new Date(tx.created_at));
      if (k < range.start || k > range.end) continue;
      const account = accountNameOf(tx);
      const id = `${k}|${account}`;
      const row = map.get(id) ?? { monthKey: k, monthLabel: monthLabel(k), account, count: 0, ...zero() };
      const amt = Math.abs(Number(tx.amount || 0));
      if (tx.type === "ad_topup") row.topup += amt;
      else row.withdraw += amt;
      row.net = row.topup - row.withdraw;
      row.count++;
      map.set(id, row);
    }
    return [...map.values()].sort((a, b) =>
      a.monthKey === b.monthKey ? b.topup - a.topup : a.monthKey.localeCompare(b.monthKey),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, adAccounts, range]);

  const rows = useMemo<MonthRow[]>(() => {
    const map = new Map<string, MonthRow>();
    const [sy, sm] = range.start.split("-").map(Number);
    const [ey, em] = range.end.split("-").map(Number);
    if (sy && sm && ey && em) {
      const cursor = new Date(sy, sm - 1, 1);
      const last = new Date(ey, em - 1, 1);
      while (cursor <= last && map.size <= 240) {
        const k = monthKey(cursor);
        map.set(k, { key: k, label: monthLabel(k), ...zero() });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }
    for (const d of accountRows) {
      const row = map.get(d.monthKey) ?? { key: d.monthKey, label: d.monthLabel, ...zero() };
      row.topup += d.topup;
      row.withdraw += d.withdraw;
      row.net = row.topup - row.withdraw;
      map.set(d.monthKey, row);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [accountRows, range]);

  const totals = rows.reduce(
    (acc, r) => ({ topup: acc.topup + r.topup, withdraw: acc.withdraw + r.withdraw, net: acc.net + r.net }),
    zero(),
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
  const header = ["Total Top Up (USD)", "Total Withdraw (USD)", "Net Used (USD)"];
  const amounts = (r: Sums) => [r.topup.toFixed(2), r.withdraw.toFixed(2), r.net.toFixed(2)];

  const downloadDetail = () => {
    if (accountRows.length === 0) {
      toast.error("No top up or withdraw in the selected range");
      return;
    }
    const lines: (string | number)[][] = [...meta, ["Month", "Ad Account", "Transactions", ...header]];
    let current = "";
    let sub = zero();
    const flush = () => {
      if (!current) return;
      lines.push([`${current} TOTAL`, "", "", ...amounts(sub)]);
      lines.push([]);
    };
    for (const d of accountRows) {
      if (d.monthLabel !== current) {
        flush();
        current = d.monthLabel;
        sub = zero();
      }
      lines.push([d.monthLabel, d.account, d.count, ...amounts(d)]);
      sub.topup += d.topup;
      sub.withdraw += d.withdraw;
      sub.net += d.net;
    }
    flush();
    lines.push(["GRAND TOTAL", "", "", ...amounts(totals)]);
    save(toCsv(lines), `topup-withdraw-by-account_${range.start}_to_${range.end}.csv`);
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
    save(toCsv(lines), `topup-withdraw-monthly_${range.start}_to_${range.end}.csv`);
  };

  const cells = (r: Sums, bold = false) => (
    <>
      <TableCell className={`text-right ${bold ? "font-bold" : ""}`}>${money(r.topup)}</TableCell>
      <TableCell className={`text-right ${bold ? "font-bold" : ""}`}>${money(r.withdraw)}</TableCell>
      <TableCell className="text-right font-semibold">${money(r.net)}</TableCell>
    </>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
        <CardTitle className="text-base md:text-lg">Monthly Top Up & Withdraw Report</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {expanded &&
            [1, 2, 3, 6, 12].map((m) => (
              <Button
                key={m}
                size="sm"
                variant="outline"
                onClick={() => setRange(defaultRange(m))}
              >
                {m}M
              </Button>
            ))}
          <Button size="sm" variant="secondary" onClick={() => setExpanded((v) => !v)} className="gap-1">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {expanded ? "Hide report" : "Show report"}
          </Button>
        </div>
      </CardHeader>
      {expanded && (
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
            Ad Account wise CSV
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
                <TableHead>{view === "detail" ? "Ad Account" : "Month"}</TableHead>
                <TableHead className="text-right">Top Up</TableHead>
                <TableHead className="text-right">Withdraw</TableHead>
                <TableHead className="text-right">Net Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view === "detail" ? (
                <>
                  {accountRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No top up or withdraw in this period
                      </TableCell>
                    </TableRow>
                  )}
                  {accountRows.map((d, i) => {
                    const newMonth = i === 0 || accountRows[i - 1].monthKey !== d.monthKey;
                    const month = rows.find((r) => r.key === d.monthKey);
                    return (
                      <Fragment key={`${d.monthKey}-${d.account}`}>
                        {newMonth && month && (
                          <TableRow className="bg-muted/50">
                            <TableCell className="font-semibold">{d.monthLabel}</TableCell>
                            {cells(month, true)}
                          </TableRow>
                        )}
                        <TableRow>
                          <TableCell className="font-medium">{d.account}</TableCell>
                          {cells(d)}
                        </TableRow>
                      </Fragment>
                    );
                  })}
                </>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    {cells(r)}
                  </TableRow>
                ))
              )}
              <TableRow>
                <TableCell className="font-bold">GRAND TOTAL</TableCell>
                {cells(totals, true)}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
      )}
    </Card>
  );
}
