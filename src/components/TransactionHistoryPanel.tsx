import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, ChevronDown, ChevronUp } from "lucide-react";
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

type Cap = { old: number; next: number | null; status?: string };
function capOf(tx: any): Cap | null {
  if (tx.limit_status && tx.old_spend_cap != null) {
    return {
      old: Number(tx.old_spend_cap),
      next: tx.new_spend_cap != null ? Number(tx.new_spend_cap) : null,
      status: tx.limit_status,
    };
  }
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

type FundingFlow = {
  mainOut: number;
  mainAfter: number;
  walletIn: number;
  walletAfter: number;
  rate: string | null;
};

/** One-line funding summary with a small arrow toggle that expands the full 3-step flow. */
function PaymentFlowRow({
  flow,
  target,
  topupAmount,
  topupAfter,
}: {
  flow: FundingFlow;
  target: string;
  topupAmount: number;
  topupAfter: number;
}) {
  const [open, setOpen] = useState(false);
  const mainBefore = flow.mainAfter + flow.mainOut;
  const walletBeforeFunding = flow.walletAfter - flow.walletIn;
  const topupBefore = topupAfter + topupAmount;
  const oneLine =
    `Main ${money(mainBefore)} → ${money(flow.mainAfter)} (-${money(flow.mainOut)})` +
    ` · ${target} +${money(flow.walletIn)} converted` +
    (flow.rate ? ` · rate ${flow.rate}` : "") +
    ` · Top-up -${money(topupAmount)}`;
  return (
    <div className="mt-1.5">
      <div className="flex items-start gap-1.5">
        <p className="min-w-0 flex-1 truncate text-[11px] leading-relaxed text-muted-foreground">
          {oneLine}
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Hide details" : "Show details"}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>
      {open && (
        <div className="mt-1 space-y-0.5 border-l-2 border-border pl-2 text-[11px] leading-relaxed text-muted-foreground">
          <div>
            <span className="font-semibold text-foreground">Main Wallet:</span> {money(mainBefore)} → {money(flow.mainAfter)}
            <span className="font-semibold text-destructive"> (-{money(flow.mainOut)})</span>
          </div>
          <div>
            <span className="font-semibold text-foreground">{target}:</span> {money(walletBeforeFunding)} → {money(flow.walletAfter)}
            <span className="font-semibold text-emerald-600"> (+{money(flow.walletIn)} converted)</span>
            {flow.rate ? <span> · rate {flow.rate}</span> : null}
          </div>
          <div>
            <span className="font-semibold text-foreground">Top-up:</span> {target} {money(topupBefore)} → {money(topupAfter)}
            <span className="font-semibold text-destructive"> (-{money(topupAmount)})</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function TransactionHistoryPanel({
  transactions: rawTransactions,
  adAccounts,
  resolveProcessedBy,
  secondaryEnabled = false,
  isMobile = false,
}: TransactionHistoryPanelProps) {
  const extIds = useMemo(
    () =>
      [...new Set((rawTransactions ?? [])
        .filter((t: any) => (t.type === "external_topup" || t.type === "external_topup_request") && t.reference_id)
        .map((t: any) => t.reference_id as string))],
    [rawTransactions],
  );
  const { data: extReqs = [] } = useQuery({
    queryKey: ["ext-topup-limits", extIds.join(",")],
    enabled: extIds.length > 0,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("external_topup_requests")
        .select("id, ad_account_id, spend_cap_before, spend_cap_after, limit_status")
        .in("id", extIds);
      return (data ?? []) as any[];
    },
  });
  const transactions = useMemo(() => {
    if (!extReqs.length) return rawTransactions;
    const m = new Map(extReqs.map((r: any) => [r.id, r]));
    return (rawTransactions ?? []).map((t: any) => {
      const r: any = (t.type === "external_topup" || t.type === "external_topup_request") ? m.get(t.reference_id) : null;
      if (!r) return t;
      return {
        ...t,
        limit_status:
          r.limit_status === "pending" && Date.now() - new Date(t.created_at).getTime() > 30 * 60 * 1000
            ? "not_updated"
            : r.limit_status,
        old_spend_cap: r.spend_cap_before,
        new_spend_cap: r.spend_cap_after,
        ext_ad_account_id: r.ad_account_id,
      };
    });
  }, [rawTransactions, extReqs]);
  const [walletTab, setWalletTab] = useState<"all" | "primary" | "secondary" | "credit_line">("all");
  const [month, setMonth] = useState<string>("all");
  const [account, setAccount] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  type FundingFlow = {
    mainOut: number;
    mainAfter: number;
    walletIn: number;
    walletAfter: number;
    rate: string | null;
  };

  /**
   * Keep the ledger entries intact, but present automatic funding and its
   * resulting top-up as one event. Matching uses the shared server timestamp.
   */
  const { groupedTransactions, fundingByTx } = useMemo(() => {
    const list = transactions ?? [];
    const isFundingAdjustment = (t: any) =>
      t.type === "adjustment" &&
      /^(Converted to (Secondary|Credit Line) wallet|Received from Main wallet)/.test(String(t.description || ""));
    const adjustments = list.filter(isFundingAdjustment);
    const used = new Set<string>();
    const hidden = new Set<string>();
    const funding = new Map<string, FundingFlow>();

    list.forEach((tx: any) => {
      if (isFundingAdjustment(tx) || Number(tx.amount) >= 0) return;
      if (tx.wallet_kind !== "secondary" && tx.wallet_kind !== "credit_line") return;

      const target = tx.wallet_kind === "credit_line" ? "Credit Line" : "Secondary";
      const txTime = new Date(tx.created_at).getTime();
      const related = adjustments.filter(
        (adjustment: any) =>
          !used.has(adjustment.id) &&
          adjustment.user_id === tx.user_id &&
          Math.abs(new Date(adjustment.created_at).getTime() - txTime) <= 10000 &&
          (adjustment.wallet_kind === tx.wallet_kind ||
            (adjustment.wallet_kind === "primary" && String(adjustment.description || "").includes(target))),
      );
      if (!related.length) return;
      related.forEach((a: any) => used.add(a.id));

      let mainOut = 0;
      let mainAfter = 0;
      let walletIn = 0;
      let walletAfter = 0;
      let rate: string | null = null;

      related.forEach((adjustment: any) => {
        hidden.add(adjustment.id);
        const amount = Number(adjustment.amount) || 0;
        const balanceAfter = Number(adjustment.balance_after) || 0;
        if (adjustment.wallet_kind === "primary") {
          mainOut += Math.abs(amount);
          mainAfter = balanceAfter;
        } else {
          walletIn += Math.abs(amount);
          walletAfter = balanceAfter;
        }
        const match = String(adjustment.description || "").match(
          /rate (?:converted )?(\d+(?:\.\d+)?) -> (\d+(?:\.\d+)?)/,
        );
        if (match) rate = `৳${match[1]} → ৳${match[2]}`;
      });

      funding.set(tx.id, { mainOut, mainAfter, walletIn, walletAfter, rate });
    });

    return {
      groupedTransactions: list.filter((tx: any) => !hidden.has(tx.id)),
      fundingByTx: funding,
    };
  }, [transactions]);

  const accountNameOf = (tx: any) => {
    const refId = tx.ext_ad_account_id || tx.reference_id;
    const linked = refId ? adAccounts?.find((a: any) => a.id === refId) : null;
    if (linked?.account_name) return linked.account_name;
    const desc = String(tx.description || "");
    const byName = adAccounts?.find(
      (a: any) => (a.account_name && desc.includes(a.account_name)) || (a.account_id && desc.includes(a.account_id)),
    );
    return byName?.account_name || String(tx.description || "").split("\n")[0] || "—";
  };

  const walletFiltered = useMemo(() => {
    const list = groupedTransactions;
    if (walletTab === "all") return list;
    return list.filter((tx: any) => (tx.wallet_kind ?? "primary") === walletTab);
  }, [groupedTransactions, walletTab]);

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
        const day = format(new Date(tx.created_at), "yyyy-MM-dd");
        if (month !== "all" && format(new Date(tx.created_at), "yyyy-MM") !== month) return false;
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
        if (account !== "all" && accountNameOf(tx) !== account) return false;
        return true;
      }),
    [walletFiltered, month, account, dateFrom, dateTo, adAccounts],
  );

  /** Per-account totals (spent = negative amounts) for the current filters, split per wallet. */
  const breakdown = useMemo(() => {
    const map = new Map<
      string,
      { spent: number; added: number; count: number; spentMain: number; spentSecondary: number; spentCreditLine: number }
    >();
    rows.forEach((tx: any) => {
      const key = accountNameOf(tx);
      const cur =
        map.get(key) ?? { spent: 0, added: 0, count: 0, spentMain: 0, spentSecondary: 0, spentCreditLine: 0 };
      const amt = Number(tx.amount) || 0;
      if (amt < 0) {
        cur.spent += Math.abs(amt);
        if (tx.wallet_kind === "secondary") cur.spentSecondary += Math.abs(amt);
        else if (tx.wallet_kind === "credit_line") cur.spentCreditLine += Math.abs(amt);
        else cur.spentMain += Math.abs(amt);
      } else cur.added += amt;
      cur.count += 1;
      map.set(key, cur);
    });
    return [...map.entries()].sort((a, b) => b[1].spent - a[1].spent);
  }, [rows, adAccounts]);

  const totals = useMemo(() => {
    let spent = 0;
    let added = 0;
    let spentMain = 0;
    let spentSecondary = 0;
    let spentCreditLine = 0;
    rows.forEach((tx: any) => {
      const amt = Number(tx.amount) || 0;
      if (amt < 0) {
        spent += Math.abs(amt);
        if (tx.wallet_kind === "secondary") spentSecondary += Math.abs(amt);
        else if (tx.wallet_kind === "credit_line") spentCreditLine += Math.abs(amt);
        else spentMain += Math.abs(amt);
      } else added += amt;
    });
    return { spent, added, spentMain, spentSecondary, spentCreditLine };
  }, [rows]);


  const counts = useMemo(() => {
    const list = groupedTransactions;
    return {
      all: list.length,
      primary: list.filter((t: any) => (t.wallet_kind ?? "primary") === "primary").length,
      secondary: list.filter((t: any) => t.wallet_kind === "secondary").length,
      creditLine: list.filter((t: any) => t.wallet_kind === "credit_line").length,
    };
  }, [groupedTransactions]);

  const enrich = (tx: any) => {
    const linkedAccount =
      tx.reference_id && tx.type === "ad_topup"
        ? adAccounts?.find((a: any) => a.id === tx.reference_id)
        : null;
    const parts = String(tx.description || "").split("\n");
    const title = parts[0] || "—";
    const sub = parts[1] || null;
    const baseExtra = parts.slice(2).filter((p) => !p.trim().startsWith("Cap:")).join(" ");
    const extra = baseExtra;
    const walletKind = (tx.wallet_kind ?? "primary") as "primary" | "secondary" | "credit_line";
    return { linkedAccount, title, sub, extra, cap: capOf(tx), walletKind };
  };

  const paymentFlow = (tx: any) => {
    const flow = fundingByTx.get(tx.id);
    if (!flow) return null;
    const target = tx.wallet_kind === "credit_line" ? "Credit Line" : "Secondary";
    const topupAmount = Math.abs(Number(tx.amount) || 0);
    const topupAfter = Number(tx.balance_after) || 0;
    const mainBefore = flow.mainAfter + flow.mainOut;
    const walletBeforeFunding = flow.walletAfter - flow.walletIn;
    const topupBefore = topupAfter + topupAmount;

    return (
      <div className="mt-1.5 space-y-0.5 border-l-2 border-border pl-2 text-[11px] leading-relaxed text-muted-foreground">
        <div>
          <span className="font-semibold text-foreground">Main Wallet:</span> {money(mainBefore)} → {money(flow.mainAfter)}
          <span className="font-semibold text-destructive"> (-{money(flow.mainOut)})</span>
        </div>
        <div>
          <span className="font-semibold text-foreground">{target}:</span> {money(walletBeforeFunding)} → {money(flow.walletAfter)}
          <span className="font-semibold text-emerald-600"> (+{money(flow.walletIn)} converted)</span>
          {flow.rate ? <span> · rate {flow.rate}</span> : null}
        </div>
        <div>
          <span className="font-semibold text-foreground">Top-up:</span> {target} {money(topupBefore)} → {money(topupAfter)}
          <span className="font-semibold text-destructive"> (-{money(topupAmount)})</span>
        </div>
      </div>
    );
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
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="date"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={(e) => setDateTo(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        />
      </div>
      {(month !== "all" || account !== "all" || dateFrom || dateTo) && (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => {
            setMonth("all");
            setAccount("all");
            setDateFrom("");
            setDateTo("");
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
          {walletTab === "secondary" ? "Secondary" : walletTab === "credit_line" ? "Credit Line" : walletTab === "primary" ? "Main" : "All"} ·{" "}
          {dateFrom || dateTo
            ? `${dateFrom || "…"} → ${dateTo || "…"}`
            : month === "all"
              ? "All months"
              : months.find(([k]) => k === month)?.[1]}
        </span>
        <span className="text-muted-foreground">
          Taken (spent): <span className="font-bold text-destructive">{money(totals.spent)}</span>
        </span>
        {secondaryEnabled && (
          <span className="text-muted-foreground">
            Main: <span className="font-bold text-blue-600">{money(totals.spentMain)}</span>
            <span className="mx-1.5">·</span>
            Secondary: <span className="font-bold text-emerald-600">{money(totals.spentSecondary)}</span>
            <span className="mx-1.5">·</span>
            Credit Line: <span className="font-bold text-sky-600">{money(totals.spentCreditLine)}</span>
          </span>
        )}
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
              {secondaryEnabled && v.spentSecondary > 0 && (
                <span className="ml-1.5 text-[10px]">
                  <span className="text-blue-600 font-semibold">M {money(v.spentMain)}</span>
                  <span className="mx-1 text-muted-foreground">/</span>
                  <span className="text-emerald-600 font-semibold">S {money(v.spentSecondary)}</span>
                </span>
              )}
              {v.spentCreditLine > 0 && (
                <span className="ml-1.5 text-[10px] font-semibold text-sky-600">CL {money(v.spentCreditLine)}</span>
              )}
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
              <TabsTrigger value="credit_line" className="text-xs px-3 data-[state=active]:text-sky-600">
                Credit Line <span className="ml-1 text-muted-foreground">{counts.creditLine}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>
      {filters}
      {summary}
    </div>
  );

  const capCell = (cap: Cap | null) =>
    cap ? (
      <span className="inline-flex flex-wrap items-center gap-1.5 whitespace-nowrap text-sm font-bold">
        <span className="text-muted-foreground">{money(cap.old)}</span>
        <ArrowRight className="h-4 w-4 text-primary" />
        {cap.next != null ? (
          <span className="text-foreground">{money(cap.next)}</span>
        ) : cap.status === "not_updated" ? (
          <span className="text-xs text-destructive">Limit বাড়েনি</span>
        ) : (
          <span className="text-xs text-amber-600 animate-pulse">Updating…</span>
        )}
        {cap.status === "manual" && (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">✓ Completed (Admin)</span>
        )}
        {cap.status === "updated" && (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">✓ Completed</span>
        )}
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
            const { linkedAccount, title, extra, cap, walletKind } = enrich(tx);
            const isSecondary = walletKind === "secondary";
            const isCreditLine = walletKind === "credit_line";
            const isPositive = Number(tx.amount) >= 0;
            return (
              <div
                key={tx.id}
                className={cn(
                  "rounded-xl border p-3",
                  isSecondary
                    ? "border-green-200/70 bg-green-50/40 dark:border-green-900/50 dark:bg-green-950/15"
                    : isCreditLine
                      ? "border-sky-200/70 bg-sky-50/40 dark:border-sky-900/50 dark:bg-sky-950/15"
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
                          ? "border-green-300 text-green-700 dark:text-green-300"
                          : isCreditLine
                            ? "border-sky-300 text-sky-700 dark:text-sky-300"
                          : "border-blue-300 text-blue-700 dark:text-blue-300",
                      )}
                    >
                      {isSecondary ? "Secondary" : isCreditLine ? "Credit Line" : "Main"}
                    </Badge>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      <ExpandableText text={linkedAccount?.account_name || title} limit={40} />
                    </p>
                    {cap && (
                      <p className="mt-1 flex items-center gap-1 text-xs font-semibold">
                        <span className="text-muted-foreground">Cap</span> {capCell(cap)}
                      </p>
                    )}
                    {extra && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        <ExpandableText text={extra} limit={50} />
                      </p>
                    )}
                    {paymentFlow(tx)}
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
                <TableHead className="w-[27%]">Ad Account / Note</TableHead>
                <TableHead className="w-[19%] text-[13px] font-semibold">Spend Cap</TableHead>
                <TableHead className="w-[9%] text-right">Amount</TableHead>
                <TableHead className="w-[10%] text-right">Balance</TableHead>
                <TableHead className="w-[12%]">Processed By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((tx: any) => {
                const { linkedAccount, title, sub, extra, cap, walletKind } = enrich(tx);
                const isSecondary = walletKind === "secondary";
                const isCreditLine = walletKind === "credit_line";
                const isPositive = Number(tx.amount) >= 0;
                return (
                  <TableRow
                    key={tx.id}
                    className={cn(
                      "align-middle",
                      isSecondary && "bg-green-50/40 dark:bg-green-950/15",
                      isCreditLine && "bg-sky-50/40 dark:bg-sky-950/15",
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
                            ? "border-green-300 text-green-700 dark:text-green-300"
                            : isCreditLine
                              ? "border-sky-300 text-sky-700 dark:text-sky-300"
                            : "border-blue-300 text-blue-700 dark:text-blue-300",
                        )}
                      >
                        {isSecondary ? "Secondary" : isCreditLine ? "Credit Line" : "Main"}
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
                      {paymentFlow(tx)}
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
