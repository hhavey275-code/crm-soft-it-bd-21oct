import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowDownLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface TransactionHistoryPanelProps {
  transactions?: any[] | null;
  adAccounts?: any[] | null;
  /** Resolves the "Processed By" label for a transaction. */
  resolveProcessedBy?: (tx: any) => string;
  secondaryEnabled?: boolean;
  isMobile?: boolean;
}

/** Collapses long text to one line with a clickable "…" that expands it. */
function ExpandableText({ text, limit = 60 }: { text: string; limit?: number }) {
  const [open, setOpen] = useState(false);
  if (!text) return <span className="text-muted-foreground">—</span>;
  if (text.length <= limit) return <span>{text}</span>;
  return (
    <span>
      {open ? text : `${text.slice(0, limit).trimEnd()}`}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 text-primary font-semibold hover:underline"
      >
        {open ? "less" : "…"}
      </button>
    </span>
  );
}

function capOf(tx: any): { old: number; next: number } | null {
  if (tx.old_spend_cap != null && tx.new_spend_cap != null) {
    return { old: Number(tx.old_spend_cap), next: Number(tx.new_spend_cap) };
  }
  const parts = String(tx.description || "").split("\n");
  const line = parts.find((p: string) => p.trim().startsWith("Cap:"));
  if (!line) return null;
  const nums = line.replace(/[^0-9.→>-]/g, " ").split(/\s+/).filter(Boolean);
  if (nums.length < 2) return null;
  return { old: Number(nums[0]), next: Number(nums[1]) };
}

const money = (n: number) =>
  `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function TransactionHistoryPanel({
  transactions,
  adAccounts,
  resolveProcessedBy,
  secondaryEnabled = false,
  isMobile = false,
}: TransactionHistoryPanelProps) {
  const [walletTab, setWalletTab] = useState<"all" | "primary" | "secondary">("all");
  const [month, setMonth] = useState<string>("all");
  const [account, setAccount] = useState<string>("all");

  const accountNameOf = (tx: any) => {
    const linked =
      tx.reference_id && tx.type === "ad_topup"
        ? adAccounts?.find((a: any) => a.id === tx.reference_id)
        : null;
    return linked?.account_name || String(tx.description || "").split("\n")[0] || "—";
  };

  const walletFiltered = useMemo(() => {
    const list = transactions ?? [];
    if (walletTab === "all") return list;
    return list.filter((tx: any) =>
      walletTab === "secondary" ? tx.wallet_kind === "secondary" : tx.wallet_kind !== "secondary",
    );
  }, [transactions, walletTab]);

  const months = useMemo(() => {
    const set = new Map<string, string>();
    (transactions ?? []).forEach((tx: any) => {
      const d = new Date(tx.created_at);
      set.set(format(d, "yyyy-MM"), format(d, "MMM yyyy"));
    });
    return [...set.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [transactions]);

  const accountOptions = useMemo(() => {
    const set = new Set<string>();
    walletFiltered.forEach((tx: any) => set.add(accountNameOf(tx)));
    return [...set].sort();
  }, [walletFiltered, adAccounts]);

  const rows = useMemo(
    () =>
      walletFiltered.filter((tx: any) => {
        if (month !== "all" && format(new Date(tx.created_at), "yyyy-MM") !== month) return false;
        if (account !== "all" && accountNameOf(tx) !== account) return false;
        return true;
      }),
    [walletFiltered, month, account, adAccounts],
  );

  /** Per-account totals (spent = negative amounts) for the current filters. */
  const breakdown = useMemo(() => {
    const map = new Map<string, { spent: number; added: number; count: number }>();
    rows.forEach((tx: any) => {
      const key = accountNameOf(tx);
      const cur = map.get(key) ?? { spent: 0, added: 0, count: 0 };
      const amt = Number(tx.amount) || 0;
      if (amt < 0) cur.spent += Math.abs(amt);
      else cur.added += amt;
      cur.count += 1;
      map.set(key, cur);
    });
    return [...map.entries()].sort((a, b) => b[1].spent - a[1].spent);
  }, [rows, adAccounts]);

  const totals = useMemo(() => {
    let spent = 0;
    let added = 0;
    rows.forEach((tx: any) => {
      const amt = Number(tx.amount) || 0;
      if (amt < 0) spent += Math.abs(amt);
      else added += amt;
    });
    return { spent, added };
  }, [rows]);

  const counts = useMemo(() => {
    const list = transactions ?? [];
    return {
      all: list.length,
      primary: list.filter((t: any) => t.wallet_kind !== "secondary").length,
      secondary: list.filter((t: any) => t.wallet_kind === "secondary").length,
    };
  }, [transactions]);

  const enrich = (tx: any) => {
    const linkedAccount =
      tx.reference_id && tx.type === "ad_topup"
        ? adAccounts?.find((a: any) => a.id === tx.reference_id)
        : null;
    const parts = String(tx.description || "").split("\n");
    const title = parts[0] || "—";
    const sub = parts[1] || null;
    const extra = parts.slice(2).filter((p) => !p.trim().startsWith("Cap:")).join(" ");
    return { linkedAccount, title, sub, extra, cap: capOf(tx), isSecondary: tx.wallet_kind === "secondary" };
  };

  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={month} onValueChange={setMonth}>
        <SelectTrigger className="h-8 w-[140px] text-xs">
          <SelectValue placeholder="Month" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All months</SelectItem>
          {months.map(([k, label]) => (
            <SelectItem key={k} value={k}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={account} onValueChange={setAccount}>
        <SelectTrigger className="h-8 w-[190px] text-xs">
          <SelectValue placeholder="Ad account" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value="all">All accounts</SelectItem>
          {accountOptions.map((a) => (
            <SelectItem key={a} value={a}>
              {a.length > 32 ? `${a.slice(0, 32)}…` : a}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(month !== "all" || account !== "all") && (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => {
            setMonth("all");
            setAccount("all");
          }}
        >
          Reset
        </button>
      )}
    </div>
  );

  const summary = (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span className="font-semibold">
          {walletTab === "secondary" ? "Secondary" : walletTab === "primary" ? "Main" : "All"} ·{" "}
          {month === "all" ? "All months" : months.find(([k]) => k === month)?.[1]}
        </span>
        <span className="text-muted-foreground">
          Taken (spent): <span className="font-bold text-destructive">{money(totals.spent)}</span>
        </span>
        <span className="text-muted-foreground">
          Added: <span className="font-bold text-emerald-600">{money(totals.added)}</span>
        </span>
        <span className="text-muted-foreground">{rows.length} txn</span>
      </div>
      {breakdown.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {breakdown.slice(0, 8).map(([name, v]) => (
            <button
              key={name}
              type="button"
              onClick={() => setAccount(name)}
              className="rounded-lg border border-border/60 bg-background px-2 py-1 text-[11px] hover:border-primary/60"
              title={name}
            >
              <span className="font-medium">{name.length > 22 ? `${name.slice(0, 22)}…` : name}</span>
              <span className="ml-1.5 font-bold text-destructive">{money(v.spent)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const header = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Transaction History</h2>
        {secondaryEnabled && (
          <Tabs value={walletTab} onValueChange={(v) => setWalletTab(v as any)}>
            <TabsList className="h-8">
              <TabsTrigger value="all" className="text-xs px-3">
                All <span className="ml-1 text-muted-foreground">{counts.all}</span>
              </TabsTrigger>
              <TabsTrigger value="primary" className="text-xs px-3 data-[state=active]:text-blue-600">
                Main <span className="ml-1 text-muted-foreground">{counts.primary}</span>
              </TabsTrigger>
              <TabsTrigger value="secondary" className="text-xs px-3 data-[state=active]:text-green-600">
                Secondary <span className="ml-1 text-muted-foreground">{counts.secondary}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>
      {filters}
      {summary}
    </div>
  );

  const capCell = (cap: { old: number; next: number } | null) =>
    cap ? (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-bold">
        <span className="text-muted-foreground">{money(cap.old)}</span>
        <ArrowRight className="h-4 w-4 text-primary" />
        <span className="text-foreground">{money(cap.next)}</span>
      </span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );


  if (isMobile) {
    return (
      <div className="space-y-3">
        {header}
        <div className="space-y-2">
          {rows.map((tx: any) => {
            const { linkedAccount, title, extra, cap, isSecondary } = enrich(tx);
            const isPositive = Number(tx.amount) >= 0;
            return (
              <div
                key={tx.id}
                className={cn(
                  "rounded-xl border p-3",
                  isSecondary
                    ? "border-teal-200/70 bg-teal-50/60 dark:border-teal-900/50 dark:bg-teal-950/20"
                    : "border-border/60 bg-card",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className={cn(
                      "mt-0.5 h-8 w-8 shrink-0 rounded-full flex items-center justify-center",
                      isPositive ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30",
                    )}
                  >
                    {isPositive ? (
                      <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4 text-destructive" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold capitalize">{tx.type.replace(/_/g, " ")}</p>
                      <p
                        className={cn(
                          "text-sm font-bold shrink-0",
                          isPositive ? "text-emerald-600" : "text-destructive",
                        )}
                      >
                        {isPositive ? "+" : "-"}
                        {money(Number(tx.amount))}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "mt-1 h-4 px-1.5 text-[9px] font-semibold uppercase tracking-wide",
                        isSecondary
                          ? "border-teal-300 text-teal-700 dark:text-teal-300"
                          : "border-blue-300 text-blue-700 dark:text-blue-300",
                      )}
                    >
                      {isSecondary ? "Secondary" : "Main"}
                    </Badge>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      <ExpandableText text={linkedAccount?.account_name || title} limit={40} />
                    </p>
                    {cap && <p className="mt-0.5 text-[11px] font-medium">Cap {capCell(cap)}</p>}
                    {extra && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        <ExpandableText text={extra} limit={50} />
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{format(new Date(tx.created_at), "MMM d, yyyy HH:mm")}</span>
                      <span>
                        Bal:{" "}
                        <span className="font-medium text-foreground">
                          ${Number(tx.balance_after ?? 0).toLocaleString()}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No transactions</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="border-border/40 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
      <CardContent className="pt-5">
        {header}
        <div className="mt-4 overflow-x-auto">
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[11%]">Date</TableHead>
                <TableHead className="w-[12%]">Type</TableHead>
                <TableHead className="w-[30%]">Ad Account / Note</TableHead>
                <TableHead className="w-[16%]">Spend Cap</TableHead>
                <TableHead className="w-[9%] text-right">Amount</TableHead>
                <TableHead className="w-[10%] text-right">Balance</TableHead>
                <TableHead className="w-[12%]">Processed By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((tx: any) => {
                const { linkedAccount, title, sub, extra, cap, isSecondary } = enrich(tx);
                const isPositive = Number(tx.amount) >= 0;
                return (
                  <TableRow
                    key={tx.id}
                    className={cn(
                      "align-middle",
                      isSecondary && "bg-teal-50/60 dark:bg-teal-950/20",
                    )}
                  >
                    <TableCell className="py-2.5 whitespace-nowrap text-[13px] text-muted-foreground">
                      {format(new Date(tx.created_at), "MMM d, yyyy")}
                      <span className="block text-[11px]">{format(new Date(tx.created_at), "HH:mm")}</span>
                    </TableCell>
                    <TableCell className="py-2.5 text-[13px]">
                      <span className="block font-medium capitalize leading-tight">{tx.type.replace(/_/g, " ")}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "mt-1 block w-fit h-4 px-1.5 text-[9px] font-semibold uppercase tracking-wide",
                          isSecondary
                            ? "border-teal-300 text-teal-700 dark:text-teal-300"
                            : "border-blue-300 text-blue-700 dark:text-blue-300",
                        )}
                      >
                        {isSecondary ? "Secondary" : "Main"}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2.5 text-[13px] break-words">
                      <span className="font-medium">
                        <ExpandableText text={linkedAccount?.account_name || title} limit={44} />
                      </span>
                      {(linkedAccount?.account_id || sub) && (
                        <span className="block font-mono text-[11px] text-muted-foreground">
                          {(linkedAccount?.account_id || sub || "").replace(/^act_/, "")}
                        </span>
                      )}
                      {extra && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          <ExpandableText text={extra} limit={60} />
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-2.5">{capCell(cap)}</TableCell>
                    <TableCell
                      className={cn(
                        "py-2.5 text-right text-[13px] font-semibold whitespace-nowrap",
                        isPositive ? "text-emerald-600" : "text-destructive",
                      )}
                    >
                      {isPositive ? "+" : "-"}
                      {money(Number(tx.amount))}
                    </TableCell>
                    <TableCell className="py-2.5 text-right text-[13px] font-medium whitespace-nowrap">
                      ${Number(tx.balance_after ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="py-2.5 text-[12px] text-muted-foreground break-words">
                      <ExpandableText text={resolveProcessedBy?.(tx) || "—"} limit={28} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No transactions
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
