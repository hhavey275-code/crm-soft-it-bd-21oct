import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import { ImageIcon, CalendarIcon, X, Wallet, ArrowDownLeft, ArrowUpRight, RefreshCw, Landmark, TrendingUp, Plus, Clock, CheckCircle2, XCircle, Download } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { SellerSubmitUsdtDialog } from "./SellerSubmitUsdtDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
// v2026.04.22-balance-display — cache-bust: ensure new TOTAL footer renders
import { computeDueAdvanceRunning, formatDueAdvance, computeTransactionDelta, formatSignedBdt } from "@/lib/sellerRunningTotal";
import {
  getMonthBucket,
  isSameMonth,
  monthLabel,
  aggregateMonth,
  computeLedgerBalanceBefore,
  type MonthBucket,
} from "@/lib/sellerMonthlyClose";
import { exportAllColumnsTotal, exportColorfulMonthly, buildAvailableMonths, slugifySeller } from "@/lib/sellerExcelExports";
import { SellerNotInSheetCard } from "./SellerNotInSheetCard";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

type DatePreset = "all" | "today" | "yesterday" | "last7" | "thisMonth" | "lastMonth" | "custom";
type TypeFilter = "all" | "bdt_payment" | "usdt_received" | "withdraw" | "client_topup";

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "all", label: "All Time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 Days" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "custom", label: "Custom" },
];

function getPresetRange(preset: DatePreset): { from: Date; to: Date } | null {
  const now = new Date();
  switch (preset) {
    case "today": return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": { const y = subDays(now, 1); return { from: startOfDay(y), to: endOfDay(y) }; }
    case "last7": return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case "thisMonth": return { from: startOfMonth(now), to: endOfDay(now) };
    case "lastMonth": { const lm = subMonths(now, 1); return { from: startOfMonth(lm), to: endOfMonth(lm) }; }
    default: return null;
  }
}

export function SellerDashboard() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [bankFilter, setBankFilter] = useState<string | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const today = new Date();
  const [monthView, setMonthView] = useState<boolean>(false);
  const [activeBucket, setActiveBucket] = useState<MonthBucket>({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [showMonthlyExport, setShowMonthlyExport] = useState(false);
  const [exportBucket, setExportBucket] = useState<MonthBucket>({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [exportAllMonths, setExportAllMonths] = useState(true);

  const { data: transactions, isLoading } = useQuery({
    queryKey: ["seller-transactions", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("seller_transactions")
        .select("*, bank_accounts(bank_name, account_number), top_up_requests(payment_reference)")
        .eq("seller_id", user!.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
    enabled: !!user,
  });

  const { data: assignedUsdtBanks } = useQuery({
    queryKey: ["seller-assigned-usdt-banks", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("seller_usdt_banks")
        .select("bank_account_id, bank_accounts(id, bank_name, account_number, account_name)")
        .eq("seller_id", user!.id);
      if (error) throw error;
      return (data as any[])?.map((r) => r.bank_accounts).filter(Boolean) ?? [];
    },
  });

  const banks = useMemo(() => {
    if (!transactions) return [];
    const bankMap = new Map<string, { id: string; name: string; account: string }>();
    transactions.forEach((t: any) => {
      if (t.bank_account_id && t.bank_accounts) {
        bankMap.set(t.bank_account_id, {
          id: t.bank_account_id,
          name: t.bank_accounts.bank_name,
          account: t.bank_accounts.account_number,
        });
      }
    });
    return Array.from(bankMap.values());
  }, [transactions]);

  const filtered = useMemo(() => {
    if (!transactions) return [];
    let result = transactions;
    if (typeFilter !== "all") {
      if (typeFilter === "bdt_payment") {
        result = result.filter((t: any) => t.type === "bdt_payment" || t.type === "client_topup");
      } else {
        result = result.filter((t: any) => t.type === typeFilter);
      }
    }
    if (bankFilter) {
      result = result.filter((t: any) => t.bank_account_id === bankFilter);
    }
    let range: { from: Date; to: Date } | null = null;
    if (datePreset === "custom" && customFrom && customTo) {
      range = { from: startOfDay(customFrom), to: endOfDay(customTo) };
    } else if (datePreset !== "all") {
      range = getPresetRange(datePreset);
    }
    if (range) {
      result = result.filter((t: any) => {
        const d = new Date(t.created_at);
        return isWithinInterval(d, { start: range!.from, end: range!.to });
      });
    }
    if (monthView) {
      result = result.filter((t: any) => isSameMonth(getMonthBucket(t.created_at), activeBucket));
    }
    return result;
  }, [transactions, typeFilter, bankFilter, datePreset, customFrom, customTo, monthView, activeBucket]);

  const availableMonths = useMemo(() => buildAvailableMonths(transactions || []), [transactions]);
  const lifetimeDueAdvance = useMemo(() => {
    let r = 0;
    for (const t of (transactions || [])) r += computeTransactionDelta(t);
    return r;
  }, [transactions]);
  const monthOpening = useMemo(
    () => computeLedgerBalanceBefore(transactions || [], activeBucket),
    [transactions, activeBucket]
  );
  const monthAgg = useMemo(
    () => aggregateMonth(transactions || [], activeBucket),
    [transactions, activeBucket]
  );
  const monthDueAdvance = monthOpening + monthAgg.delta;

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc: any, t: any) => {
        // Only count approved (or legacy null/empty) entries — exclude pending and rejected
        const status = t.status || "approved";
        if (status !== "approved") return acc;
        if (t.type === "bdt_payment" || t.type === "tenant_payment") acc.totalBdtPaid += Number(t.bdt_amount || 0);
        if (t.type === "usdt_received") {
          acc.totalUsdt += Math.abs(Number(t.usdt_amount || 0));
          acc.totalConvertedBdt += Math.abs(Number(t.usdt_amount || 0)) * Number(t.rate || 0);
        }
        if (t.type === "client_topup") acc.totalClientBdt += Number(t.bdt_amount || 0);
        if (t.type === "withdraw") acc.totalWithdrawn += Math.abs(Number(t.bdt_amount || 0));
        return acc;
      },
      { totalBdtPaid: 0, totalUsdt: 0, totalConvertedBdt: 0, totalClientBdt: 0, totalWithdrawn: 0 }
    );
  }, [filtered]);

  const filteredDueAdvance = totals.totalBdtPaid + totals.totalClientBdt - totals.totalConvertedBdt - totals.totalWithdrawn;
  const dueAdvance = monthView ? monthDueAdvance : (typeFilter === "all" && !bankFilter && datePreset === "all" ? lifetimeDueAdvance : filteredDueAdvance);

  // Running Due/Advance balance per row — computed from ALL transactions (not just filtered),
  // so each filtered row still shows its true historical balance up to that point.
  const runningTotals = useMemo(() => computeDueAdvanceRunning(transactions || []), [transactions]);
  const hasActiveFilter = typeFilter !== "all" || bankFilter || datePreset !== "all";
  const clearAllFilters = () => { setTypeFilter("all"); setBankFilter(null); setDatePreset("all"); setCustomFrom(undefined); setCustomTo(undefined); };
  const toggleTypeFilter = (type: TypeFilter) => setTypeFilter(prev => prev === type ? "all" : type);

  const getTypeLabel = (type: string) =>
    type === "usdt_received" ? "USDT Given" : type === "bdt_payment" ? "BDT Payment" : type === "withdraw" ? "Withdraw" : "Client Top-Up";

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "bdt_payment": return <ArrowDownLeft className="h-3.5 w-3.5" />;
      case "usdt_received": return <ArrowUpRight className="h-3.5 w-3.5" />;
      case "withdraw": return <RefreshCw className="h-3.5 w-3.5" />;
      default: return <TrendingUp className="h-3.5 w-3.5" />;
    }
  };

  const fmt = (v: number, prefix: string) => v > 0 ? `${prefix}${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "0";

  const sellerSlug = useMemo(
    () => slugifySeller((user as any)?.user_metadata?.full_name || user?.email),
    [user]
  );

  const exportToExcel = () => {
    try {
      exportAllColumnsTotal(transactions || [], sellerSlug);
      toast.success("Exported full ledger");
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    }
  };

  const handleMonthlyExport = () => {
    try {
      const buckets = exportAllMonths ? [...availableMonths].reverse() : [exportBucket];
      const total = exportColorfulMonthly(transactions || [], sellerSlug, buckets);
      toast.success(exportAllMonths ? `Exported ${buckets.length} months` : `Exported ${monthLabel(exportBucket)}`);
      setShowMonthlyExport(false);
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    }
  };

  const StatusBadge = ({ status }: { status?: string | null }) => {
    const s = (status || "approved").toLowerCase();
    if (s === "approved") return null; // No badge for approved (default state)
    if (s === "pending") return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400">
        <Clock className="h-2.5 w-2.5" /> Pending
      </span>
    );
    if (s === "rejected") return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-500/15 text-rose-600 dark:text-rose-400">
        <XCircle className="h-2.5 w-2.5" /> Rejected
      </span>
    );
    return null;
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center justify-between gap-3 md:justify-start">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 shadow-lg shadow-primary/20">
              <Wallet className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground truncate">Seller Dashboard</h1>
              <p className="text-xs text-muted-foreground truncate">Financial overview & transaction ledger</p>
            </div>
          </div>
          <Button className="md:hidden" size="sm" onClick={() => setShowSubmit(true)}>
            <Plus className="h-4 w-4 mr-1" /> USDT
          </Button>
        </div>
        <div className="flex items-center gap-2 md:shrink-0 md:justify-end">
          <Button className="flex-1 md:flex-none" size={isMobile ? "sm" : "default"} variant="outline" onClick={exportToExcel}>
            <Download className="h-4 w-4 mr-1" /> <span>Excel</span>
          </Button>
          <Button className="flex-1 md:flex-none" size={isMobile ? "sm" : "default"} variant="outline" onClick={() => { setExportBucket(activeBucket); setShowMonthlyExport(true); }}>
            <Download className="h-4 w-4 mr-1" /> <span>Monthly</span><span className="hidden md:inline">&nbsp;Excel</span>
          </Button>
          <Button className="hidden md:inline-flex" size="default" onClick={() => setShowSubmit(true)}>
            <Plus className="h-4 w-4 mr-1" /> Submit USDT
          </Button>
        </div>
      </div>

      {/* Month View Toolbar */}
      <div className="rounded-xl border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={monthView ? "default" : "outline"}
            onClick={() => setMonthView(v => !v)}
          >
            {monthView ? "Month View: ON" : "Month View: OFF"}
          </Button>
          <Select
            value={`${activeBucket.year}-${activeBucket.month}`}
            onValueChange={(v) => {
              const [y, m] = v.split("-").map(Number);
              setActiveBucket({ year: y, month: m });
            }}
          >
            <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {availableMonths.map(b => (
                <SelectItem key={`${b.year}-${b.month}`} value={`${b.year}-${b.month}`}>
                  {monthLabel(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {monthView && (
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <span className={cn(
                "text-xs px-2.5 py-1 rounded-full border font-medium",
                monthOpening >= 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900"
                                  : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900"
              )}>
                Opening: {monthOpening >= 0 ? "+" : "−"}৳{Math.abs(monthOpening).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
              <span className={cn(
                "text-xs px-2.5 py-1 rounded-full border font-semibold",
                monthDueAdvance >= 0 ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800"
                                      : "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800"
              )}>
                Current: {monthDueAdvance >= 0 ? "+" : "−"}৳{Math.abs(monthDueAdvance).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>
        {monthView && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Showing only {monthLabel(activeBucket)} transactions. Running balance carries forward from previous month.
          </p>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {/* Due/Advance — Hero Card */}
        <div className={cn(
          "col-span-2 md:col-span-1 relative overflow-hidden rounded-xl p-[1px]",
          dueAdvance >= 0
            ? "bg-gradient-to-br from-emerald-500 to-teal-600"
            : "bg-gradient-to-br from-rose-500 to-red-600"
        )}>
          <div className="h-full rounded-[11px] bg-card/95 backdrop-blur-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg",
                dueAdvance >= 0 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
              )}>
                <Wallet className="h-3.5 w-3.5" />
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {dueAdvance >= 0 ? "Advance" : "Due"}
              </span>
            </div>
            <p className={cn("text-2xl md:text-3xl font-extrabold tracking-tight", dueAdvance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
              {dueAdvance >= 0 ? "+" : "−"}৳{Math.abs(dueAdvance).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              After all transactions · {dueAdvance >= 0 ? "আপনি বেশি পেয়েছেন" : "আপনাকে দিতে হবে"}
            </p>
          </div>
        </div>

        {/* BDT Received */}
        <button
          onClick={() => toggleTypeFilter("bdt_payment")}
          className={cn(
            "group relative overflow-hidden rounded-xl border bg-card text-left transition-all duration-200 hover:shadow-lg hover:shadow-primary/5",
            typeFilter === "bdt_payment" ? "ring-2 ring-primary shadow-lg shadow-primary/10" : "hover:border-primary/30"
          )}
        >
          <div className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ArrowDownLeft className="h-3.5 w-3.5" />
              </div>
              <span className="text-[10px] md:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">BDT Received</span>
            </div>
            <p className="text-lg md:text-2xl font-extrabold tracking-tight text-foreground">৳{(totals.totalBdtPaid + totals.totalClientBdt).toLocaleString()}</p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/60 to-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>

        {/* USDT Given */}
        <button
          onClick={() => toggleTypeFilter("usdt_received")}
          className={cn(
            "group relative overflow-hidden rounded-xl border bg-card text-left transition-all duration-200 hover:shadow-lg hover:shadow-sky-500/5",
            typeFilter === "usdt_received" ? "ring-2 ring-sky-500 shadow-lg shadow-sky-500/10" : "hover:border-sky-500/30"
          )}
        >
          <div className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                <ArrowUpRight className="h-3.5 w-3.5" />
              </div>
              <span className="text-[10px] md:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">USDT Given</span>
            </div>
            <p className="text-lg md:text-2xl font-extrabold tracking-tight text-foreground">${totals.totalUsdt.toLocaleString()}</p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-sky-500/60 to-sky-500/20 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>

        {/* USDT in BDT */}
        <div className="relative overflow-hidden rounded-xl border bg-card">
          <div className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
              <span className="text-[10px] md:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">USDT (BDT)</span>
            </div>
            <p className="text-lg md:text-2xl font-extrabold tracking-tight text-foreground">৳{totals.totalConvertedBdt.toLocaleString()}</p>
          </div>
        </div>

        {/* Withdrawn */}
        <button
          onClick={() => toggleTypeFilter("withdraw")}
          className={cn(
            "group relative overflow-hidden rounded-xl border bg-card text-left transition-all duration-200 hover:shadow-lg hover:shadow-rose-500/5",
            typeFilter === "withdraw" ? "ring-2 ring-rose-500 shadow-lg shadow-rose-500/10" : "hover:border-rose-500/30"
          )}
        >
          <div className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                <RefreshCw className="h-3.5 w-3.5" />
              </div>
              <span className="text-[10px] md:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Withdrawn</span>
            </div>
            <p className="text-lg md:text-2xl font-extrabold tracking-tight text-foreground">৳{totals.totalWithdrawn.toLocaleString()}</p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-rose-500/60 to-rose-500/20 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      </div>

      {/* Not in Seller Sheet — visibility for seller */}
      {user && <SellerNotInSheetCard sellerId={user.id} />}


      {/* Filters & Banks — collapsible on mobile, always visible on desktop */}
      <Collapsible defaultOpen={!isMobile}>
        <CollapsibleTrigger asChild>
          <button className="md:hidden w-full flex items-center justify-between px-3 py-2 rounded-lg border bg-card text-sm font-semibold">
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              Filters & Banks
              {hasActiveFilter && <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">active</span>}
            </span>
            <ChevronDown className="h-4 w-4 transition-transform data-[state=open]:rotate-180" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 md:space-y-4 data-[state=closed]:md:!block pt-3 md:pt-0">
          {/* Bank Chips */}
          {banks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {banks.map((b) => {
                const bankTotal = filtered
                  .filter((t: any) => t.bank_account_id === b.id)
                  .reduce((s: number, t: any) => s + Number(t.bdt_amount || 0), 0);
                return (
                  <button
                    key={b.id}
                    onClick={() => setBankFilter(prev => prev === b.id ? null : b.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border font-medium transition-all duration-200",
                      bankFilter === b.id
                        ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20"
                        : "bg-card hover:bg-accent border-border hover:border-primary/30 text-foreground"
                    )}
                  >
                    <Landmark className="h-3 w-3 opacity-70" />
                    <span>{b.name}</span>
                    <span className="opacity-60">****{b.account?.slice(-4)}</span>
                    <span className={cn(
                      "ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold",
                      bankFilter === b.id ? "bg-primary-foreground/20" : "bg-muted"
                    )}>
                      ৳{bankTotal.toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* My Assigned USDT Banks */}
          {assignedUsdtBanks && assignedUsdtBanks.length > 0 && (
            <div className="rounded-xl border bg-card p-3 md:p-4">
              <div className="flex items-center gap-2 mb-2 md:mb-3">
                <Landmark className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold">My USDT Banks</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {assignedUsdtBanks.map((b: any) => (
                  <div key={b.id} className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg border bg-muted/30">
                    <Landmark className="h-3 w-3 text-primary" />
                    <span className="font-semibold">{b.bank_name}</span>
                    <span className="text-muted-foreground">— {b.account_number}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Date Filter Bar */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-lg bg-muted/50 border border-border/50">
            {DATE_PRESETS.filter(p => p.key !== "custom").map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant="ghost"
                className={cn(
                  "text-xs h-8 rounded-md font-medium transition-all",
                  datePreset === p.key
                    ? "bg-card text-foreground shadow-sm border border-border/60"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setDatePreset(p.key)}
              >
                {p.label}
              </Button>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className={cn(
                    "text-xs h-8 rounded-md font-medium gap-1 transition-all",
                    datePreset === "custom"
                      ? "bg-card text-foreground shadow-sm border border-border/60"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <CalendarIcon className="h-3 w-3" /> Custom
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <div className="p-3 space-y-2">
                  <Calendar
                    mode="range"
                    selected={customFrom && customTo ? { from: customFrom, to: customTo } : customFrom ? { from: customFrom, to: undefined } : undefined}
                    onSelect={(range: any) => {
                      setCustomFrom(range?.from ?? undefined);
                      setCustomTo(range?.to ?? undefined);
                      setDatePreset("custom");
                    }}
                    numberOfMonths={1}
                    className="p-2 pointer-events-auto"
                  />
                  {customFrom && (
                    <p className="text-xs text-muted-foreground text-center">
                      {format(customFrom, "MMM d, yyyy")} {customTo ? `— ${format(customTo, "MMM d, yyyy")}` : "— select end date"}
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {hasActiveFilter && (
              <Button size="sm" variant="ghost" className="text-xs h-8 gap-1 text-destructive hover:text-destructive ml-auto" onClick={clearAllFilters}>
                <X className="h-3 w-3" /> Clear
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Transaction Ledger */}
      <Card className="border-0 shadow-lg shadow-black/5 dark:shadow-black/20 bg-card/80 backdrop-blur-sm overflow-hidden rounded-xl">
        <CardHeader className="p-4 md:p-6 pb-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <TrendingUp className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base md:text-lg font-bold tracking-tight">Transaction History</CardTitle>
                {hasActiveFilter && <p className="text-[11px] text-muted-foreground">{filtered.length} results</p>}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 text-center">
              <div className="inline-flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading transactions...</span>
              </div>
            </div>
          ) : !filtered.length ? (
            <div className="py-16 text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No transactions found</p>
            </div>
          ) : isMobile ? (
            <div className="divide-y divide-border/50">
              {filtered.map((t: any) => {
                const convertedBdt = Math.abs(Number(t.usdt_amount || 0)) * Number(t.rate || 0);
                const typeColors: Record<string, string> = {
                  bdt_payment: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
                  usdt_received: "text-sky-600 dark:text-sky-400 bg-sky-500/10",
                  withdraw: "text-rose-600 dark:text-rose-400 bg-rose-500/10",
                  client_topup: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
                };
                const colorClass = typeColors[t.type] || "text-muted-foreground bg-muted";
                return (
                  <div key={t.id} className="p-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md", colorClass)}>
                        {getTypeIcon(t.type)}
                        {getTypeLabel(t.type)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={t.status} />
                        <span className="text-[10px] text-muted-foreground font-medium leading-tight text-right">
                          {format(new Date(t.created_at), "MMM d, yyyy")}
                          <span className="block text-[9px] opacity-75">{format(new Date(t.created_at), "h:mm a")}</span>
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">BDT</span>
                        <span className="font-bold text-foreground">{fmt(Number(t.bdt_amount), "৳")}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">USDT</span>
                        <span className="font-bold text-foreground">{fmt(Number(t.usdt_amount), "$")}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Rate</span>
                        <span className="font-semibold text-foreground">{Number(t.rate) > 0 ? t.rate : "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Conv</span>
                        <span className="font-bold text-foreground">{fmt(convertedBdt, "৳")}</span>
                      </div>
                    </div>
                    {t.bank_accounts && (
                      <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                        <Landmark className="h-2.5 w-2.5" /> {t.bank_accounts.bank_name} — {t.bank_accounts.account_number}
                      </p>
                    )}
                    {t.entry_by_name && (
                      <p className="text-[10px] text-primary mt-1 flex items-center gap-1 font-medium">
                        <span>👤</span> {t.entry_by_name}
                      </p>
                    )}
                    {t.description && (
                      <p className="text-[10px] text-muted-foreground mt-1 truncate">📝 {t.description}</p>
                    )}
                    {t.top_up_requests?.payment_reference && (
                      <p className="text-[10px] font-mono text-primary mt-0.5 break-all">TrxID: {t.top_up_requests.payment_reference}</p>
                    )}
                    {t.proof_url && (
                      <button
                        onClick={() => setProofUrl(t.proof_url)}
                        className="text-[10px] text-primary hover:underline flex items-center gap-1 mt-1.5 font-medium"
                      >
                        <ImageIcon className="h-3 w-3" /> View Proof
                      </button>
                    )}
                    {/* Running Due/Advance balance — enhanced TOTAL footer with delta + new running balance */}
                    {(() => {
                      const newBalance = runningTotals.get(t.id) || 0;
                      const delta = computeTransactionDelta(t);
                      const prevBalance = newBalance - delta;
                      const da = formatDueAdvance(newBalance);
                      const prev = formatDueAdvance(prevBalance);
                      const positiveDelta = delta >= 0;
                      return (
                        <div className={cn(
                          "mt-2 -mx-3 -mb-3 px-3 py-2.5 border-t-2 space-y-1.5",
                          da.isZero
                            ? "border-border bg-muted/40"
                            : da.isAdvance
                            ? "border-sky-500/40 bg-sky-500/5"
                            : "border-rose-500/40 bg-rose-500/5"
                        )}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                              📊 Running Balance
                            </span>
                            <span className={cn(
                              "text-xs font-bold tabular-nums px-1.5 py-0.5 rounded",
                              delta === 0
                                ? "text-muted-foreground bg-muted"
                                : positiveDelta
                                ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/15"
                                : "text-rose-700 dark:text-rose-400 bg-rose-500/15"
                            )}>
                              {formatSignedBdt(delta)}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider">
                              <span className={cn(
                                da.isZero ? "text-muted-foreground" : da.isAdvance ? "text-sky-700 dark:text-sky-400" : "text-rose-700 dark:text-rose-400"
                              )}>TOTAL · {da.isZero ? "—" : da.isAdvance ? "Advance" : "Due"}</span>
                            </span>
                            <span className={cn(
                              "text-base font-extrabold tabular-nums",
                              da.isZero ? "text-muted-foreground" : da.isAdvance ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400"
                            )}>{da.text}</span>
                          </div>
                          {delta !== 0 && (
                            <div className="text-[10px] text-muted-foreground tabular-nums leading-tight pt-0.5 border-t border-border/40">
                              <span className="opacity-70">Prev:</span> <span className="font-semibold">{prev.text}</span>
                              <span className="mx-1 opacity-50">→</span>
                              <span className={cn("font-bold", positiveDelta ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                                {formatSignedBdt(delta)}
                              </span>
                              <span className="mx-1 opacity-50">→</span>
                              <span className={cn("font-bold", da.isAdvance ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400")}>{da.text}</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}

              {/* Mobile Totals */}
              <div className="p-3 bg-muted/30">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Summary</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">BDT Received</span>
                    <span className="font-bold text-foreground">৳{(totals.totalBdtPaid + totals.totalClientBdt).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">USDT Given</span>
                    <span className="font-bold text-foreground">${totals.totalUsdt.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Conv BDT</span>
                    <span className="font-bold text-foreground">৳{totals.totalConvertedBdt.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/40">
                    <th className="px-1.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Date</th>
                    <th className="px-1.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Type</th>
                    <th className="px-1.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Account</th>
                    <th className="px-1.5 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">BDT</th>
                    <th className="px-1.5 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">USDT</th>
                    <th className="px-1.5 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rate</th>
                    <th className="px-1.5 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Conv BDT</th>
                    <th className="px-1.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">TrxID / Note</th>
                    <th className="px-1.5 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Proof</th>
                    <th className="px-1.5 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-primary">Due/Advance (৳)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filtered.map((t: any) => {
                    const convertedBdt = Math.abs(Number(t.usdt_amount || 0)) * Number(t.rate || 0);
                    const typeColors: Record<string, string> = {
                      bdt_payment: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
                      usdt_received: "text-sky-600 dark:text-sky-400 bg-sky-500/10",
                      withdraw: "text-rose-600 dark:text-rose-400 bg-rose-500/10",
                      client_topup: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
                    };
                    const colorClass = typeColors[t.type] || "text-muted-foreground bg-muted";
                    return (
                      <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-1.5 py-2 text-xs text-muted-foreground whitespace-nowrap leading-tight">
                          {format(new Date(t.created_at), "MMM d, yyyy")}
                          <span className="block text-[10px] opacity-75">{format(new Date(t.created_at), "h:mm a")}</span>
                        </td>
                        <td className="px-1.5 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md", colorClass)}>
                              {getTypeIcon(t.type)}
                              {getTypeLabel(t.type)}
                            </span>
                            <StatusBadge status={t.status} />
                          </div>
                        </td>
                        <td className="px-1.5 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {t.bank_accounts ? (
                            <div className="leading-tight">
                              <span className="inline-flex items-center gap-1">
                                <Landmark className="h-3 w-3 opacity-50" />
                                {t.bank_accounts.bank_name} — {t.bank_accounts.account_number}
                              </span>
                              {t.entry_by_name && (
                                <div className="text-[11px] text-primary font-medium mt-0.5">👤 {t.entry_by_name}</div>
                              )}
                            </div>
                          ) : t.entry_by_name ? (
                            <span className="text-primary font-medium">👤 {t.entry_by_name}</span>
                          ) : "—"}
                        </td>
                        <td className="px-1.5 py-2 text-right text-xs font-bold text-foreground tabular-nums">
                          {fmt(Number(t.bdt_amount), "৳")}
                        </td>
                        <td className="px-1.5 py-2 text-right text-xs font-bold text-foreground tabular-nums">
                          {fmt(Number(t.usdt_amount), "$")}
                        </td>
                        <td className="px-1.5 py-2 text-right text-xs font-semibold text-muted-foreground tabular-nums">
                          {Number(t.rate) > 0 ? t.rate : "—"}
                        </td>
                        <td className="px-1.5 py-2 text-right text-xs font-bold text-foreground tabular-nums">
                          {fmt(convertedBdt, "৳")}
                        </td>
                        <td className="px-1.5 py-2 text-xs text-muted-foreground">
                          <div className="whitespace-nowrap">{t.description || "—"}</div>
                          {t.top_up_requests?.payment_reference && (
                            <div className="text-[10px] font-mono text-primary mt-0.5">TrxID: {t.top_up_requests.payment_reference}</div>
                          )}
                        </td>
                        <td className="px-1.5 py-2 text-center">
                          {t.proof_url ? (
                            <button onClick={() => setProofUrl(t.proof_url)} className="text-primary hover:text-primary/80 transition-colors">
                              <ImageIcon className="h-4 w-4" />
                            </button>
                          ) : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        {(() => {
                          const da = formatDueAdvance(runningTotals.get(t.id) || 0);
                          const isPending = (t.status || "approved").toLowerCase() !== "approved";
                          return (
                            <td className={cn(
                              "px-1.5 py-2 text-right text-xs font-extrabold tabular-nums whitespace-nowrap",
                              isPending ? "text-muted-foreground/60 italic" :
                                da.isZero ? "text-muted-foreground" : da.isAdvance ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400"
                            )}>
                              {da.text}
                              {isPending && <div className="text-[10px] font-normal not-italic text-amber-600 dark:text-amber-400">(pending — not counted)</div>}
                            </td>
                          );
                        })()}
                      </tr>
                    );
                  })}
                  {/* Totals Row */}
                  <tr className="bg-muted/30 border-t-2 border-border/60">
                    <td className="px-1.5 py-2 text-xs font-bold text-foreground" colSpan={3}>
                      <span className="uppercase tracking-wider text-[11px]">Total</span>
                    </td>
                    <td className="px-1.5 py-2 text-right text-xs font-extrabold text-foreground tabular-nums">
                      ৳{(totals.totalBdtPaid + totals.totalClientBdt).toLocaleString()}
                    </td>
                    <td className="px-1.5 py-2 text-right text-xs font-extrabold text-foreground tabular-nums">
                      ${totals.totalUsdt.toLocaleString()}
                    </td>
                    <td className="px-1.5 py-2 text-right text-xs text-muted-foreground">—</td>
                    <td className="px-1.5 py-2 text-right text-xs font-extrabold text-foreground tabular-nums">
                      ৳{totals.totalConvertedBdt.toLocaleString()}
                    </td>
                    <td className="px-1.5 py-2" colSpan={3}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Proof Dialog */}
      <Dialog open={!!proofUrl} onOpenChange={() => setProofUrl(null)}>
        <DialogContent className="max-w-lg p-1">
          {proofUrl && <img src={proofUrl} alt="Proof" className="w-full rounded-lg" />}
        </DialogContent>
      </Dialog>

      <SellerSubmitUsdtDialog open={showSubmit} onOpenChange={setShowSubmit} />

      {/* Monthly Excel Export */}
      <Dialog open={showMonthlyExport} onOpenChange={setShowMonthlyExport}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Monthly Excel Export</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <label className="flex items-center gap-2 rounded-md border p-3 text-sm cursor-pointer">
              <Checkbox checked={exportAllMonths} onCheckedChange={(v) => setExportAllMonths(Boolean(v))} />
              <span className="font-medium">Export all months (one sheet per month)</span>
            </label>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Month</p>
              <Select
                value={`${exportBucket.year}-${exportBucket.month}`}
                disabled={exportAllMonths}
                onValueChange={(v) => {
                  const [y, m] = v.split("-").map(Number);
                  setExportBucket({ year: y, month: m });
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {availableMonths.map(b => (
                    <SelectItem key={`${b.year}-${b.month}`} value={`${b.year}-${b.month}`}>
                      {monthLabel(b)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Colorful styled sheet with opening balance, totals, and running due/advance.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMonthlyExport(false)}>Cancel</Button>
            <Button onClick={handleMonthlyExport}>
              <Download className="h-4 w-4 mr-1" /> Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
