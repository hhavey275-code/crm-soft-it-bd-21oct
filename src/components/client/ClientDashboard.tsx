import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "@/lib/router-compat";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Wallet, MonitorSmartphone, TrendingUp, CalendarIcon, ArrowUpCircle, Loader2, Download, Smartphone, Share, X, Plus, RefreshCw, ShoppingCart, Megaphone, BarChart3, DollarSign, Activity } from "lucide-react";
import { CardDueBox } from "@/components/CardDueBox";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useWallets, formatBdt } from "@/hooks/useWallets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn, friendlyEdgeError } from "@/lib/utils";
import { format, startOfMonth, endOfMonth, subMonths, subDays, eachDayOfInterval, parseISO } from "date-fns";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { logSystemAction } from "@/lib/systemLog";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Line, ComposedChart, Legend, Area, AreaChart, Tooltip as RTooltip } from "recharts";
import { TutorialButton } from "@/components/TutorialProvider";


export function ClientDashboard() {
  const { user, profile } = useAuth();
  const clientWallets = useWallets(user?.id);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { canInstall, isInstalled, isIOS, promptInstall } = useInstallPrompt();
  const { clientCardDueVisible: cardDueVisibleForClient } = useSiteSettings();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [dismissedInstall, setDismissedInstall] = useState(false);
  const isInactive = (profile as any)?.status === "inactive";
  const agencyId = (profile as any)?.agency_id;

  useEffect(() => {
    try {
      setDismissedInstall(localStorage.getItem("pwa-install-dismissed") === "true");
    } catch {
      setDismissedInstall(false);
    }
  }, []);

  // NOTE: No realtime subscription here by design (no Supabase realtime, no Meta API calls).
  // Spend/order figures are auto re-read from the DB every 60s so the numbers stay live
  // without triggering any Meta sync. Everything else follows the original rule:
  // 1st login, manual refresh (10 min cooldown), or after a top-up.
  const LIVE_REFETCH_MS = 60_000;


  const { data: agencyWallet } = useQuery({
    queryKey: ["agency-wallet-check", agencyId],
    queryFn: async () => {
      const { data } = await supabase.from("agency_wallets").select("balance").eq("agency_id", agencyId!).single();
      return data;
    },
    enabled: !!agencyId,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const agencyHasInsufficientBalance = agencyId && agencyWallet && Number(agencyWallet.balance) <= 0;

  // Spend vs Order date range — default to current month
  const [spendDateFrom, setSpendDateFrom] = useState<Date>(startOfMonth(new Date()));
  const [spendDateTo, setSpendDateTo] = useState<Date>(new Date());

  // Total Spending card date range — default all time (most accurate from ad_accounts)
  const [totalSpendPeriod, setTotalSpendPeriod] = useState<"month" | "alltime" | "custom">("alltime");
  const [totalSpendFrom, setTotalSpendFrom] = useState<Date>(startOfMonth(new Date()));
  const [totalSpendTo, setTotalSpendTo] = useState<Date>(new Date());

  // Spend cap dialog
  const [topUpAccount, setTopUpAccount] = useState<any>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpLoading, setTopUpLoading] = useState(false);

  // Ad Account Request
  const [showAdReqForm, setShowAdReqForm] = useState(false);
  const [adReqForm, setAdReqForm] = useState({ account_name: "", email: "", business_manager_id: "", monthly_spend: "", start_date: "" });
  const [adReqLoading, setAdReqLoading] = useState(false);

  const handleAdReqSubmit = async () => {
    if (!adReqForm.account_name || !adReqForm.email || !adReqForm.business_manager_id) {
      toast.error("Please fill in all required fields");
      return;
    }
    setAdReqLoading(true);
    try {
      const { error } = await (supabase as any).from("ad_account_requests").insert({
        user_id: user!.id, account_name: adReqForm.account_name, email: adReqForm.email,
        business_manager_id: adReqForm.business_manager_id, monthly_spend: adReqForm.monthly_spend || null, start_date: adReqForm.start_date || null,
      });
      if (error) throw error;
      await logSystemAction("Ad Account Requested", `"${adReqForm.account_name}" by ${profile?.full_name || user!.email}`, user!.id, profile?.full_name || user!.email);
      toast.success("Ad account request submitted!");
      setShowAdReqForm(false);
      setAdReqForm({ account_name: "", email: "", business_manager_id: "", monthly_spend: "", start_date: "" });
    } catch (err: any) { toast.error(err.message || "Failed"); } finally { setAdReqLoading(false); }
  };

  // --- Queries ---
  const { data: adAccounts } = useQuery({
    queryKey: ["client-dashboard-ad-accounts", user?.id],
    queryFn: async () => {
      const { data: assignments } = await (supabase as any).from("user_ad_accounts").select("ad_account_id").eq("user_id", user!.id);
      if (!assignments || assignments.length === 0) return [];
      const ids = assignments.map((a: any) => a.ad_account_id);
      const { data } = await supabase.from("ad_accounts").select("id, account_name, amount_spent, spend_cap, status").in("id", ids);
      return (data as any[]) ?? [];
    },
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: LIVE_REFETCH_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // Live Meta sync when the client opens the dashboard: refresh spend cap /
  // amount spent once per session (same session key as Ad Accounts page so
  // both pages share one sync), then re-read the DB numbers.
  const hasDashboardSynced = useRef(false);
  const [dashboardSyncing, setDashboardSyncing] = useState(false);
  useEffect(() => {
    if (!adAccounts || adAccounts.length === 0 || hasDashboardSynced.current) return;
    hasDashboardSynced.current = true;
    try {
      const last = Number(sessionStorage.getItem("metaSyncTimestamp") || 0);
      if (last && Date.now() - last < 10 * 60_000) return; // synced recently
    } catch { /* sessionStorage unavailable */ }

    const ids = adAccounts.map((a: any) => a.id);
    setDashboardSyncing(true);
    import("@/lib/chunkedMetaSync")
      .then(({ chunkedMetaSync }) => chunkedMetaSync(ids))
      .then((result) => {
        try { sessionStorage.setItem("metaSyncTimestamp", String(Date.now())); } catch { /* ignore */ }
        if (result?.insights) {
          queryClient.invalidateQueries({ queryKey: ["client-dashboard-ad-accounts"] });
          queryClient.invalidateQueries({ queryKey: ["client-all-insights"] });
          queryClient.invalidateQueries({ queryKey: ["client-ad-accounts"] });
        }
      })
      .catch((err) => console.log("dashboard meta sync skipped:", err))
      .finally(() => setDashboardSyncing(false));
  }, [adAccounts, queryClient]);


  const { data: allInsights } = useQuery({
    queryKey: ["client-all-insights", user?.id],
    queryFn: async () => {
      if (!adAccounts || adAccounts.length === 0) return [];
      const ids = adAccounts.map((a: any) => a.id);
      const { data } = await supabase.from("ad_account_insights")
        .select("ad_account_id, today_orders, yesterday_orders, active_campaigns, today_spend, yesterday_spend")
        .in("ad_account_id", ids);
      return data ?? [];
    },
    enabled: !!user && !!adAccounts && adAccounts.length > 0,
    staleTime: 30_000,
    refetchInterval: LIVE_REFETCH_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // Realtime subscriptions removed for performance — data refreshes only on manual actions or page reload.

  // Top-up total (all time)
  const { data: topUpTotal } = useQuery({
    queryKey: ["client-topup-total-all", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("top_up_requests").select("amount").eq("user_id", user!.id).eq("status", "approved");
      return (data as any[])?.reduce((s: number, r: any) => s + Number(r.amount), 0) ?? 0;
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Daily stats for spend vs orders chart
  const { data: dailyStats } = useQuery({
    queryKey: ["client-daily-stats", user?.id, format(spendDateFrom, "yyyy-MM-dd"), format(spendDateTo, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data } = await (supabase as any).from("client_daily_stats")
        .select("stat_date, total_spend, total_orders")
        .eq("user_id", user!.id)
        .gte("stat_date", format(spendDateFrom, "yyyy-MM-dd"))
        .lte("stat_date", format(spendDateTo, "yyyy-MM-dd"))
        .order("stat_date", { ascending: true });
      return data ?? [];
    },
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: LIVE_REFETCH_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // Monthly top-up history (last 6 months)
  const { data: monthlyTopUps } = useQuery({
    queryKey: ["client-monthly-topups", user?.id],
    queryFn: async () => {
      const sixMonthsAgo = subMonths(startOfMonth(new Date()), 5);
      const { data } = await supabase.from("top_up_requests").select("amount, created_at").eq("user_id", user!.id).eq("status", "approved")
        .gte("created_at", sixMonthsAgo.toISOString()).order("created_at", { ascending: true });
      return data ?? [];
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // --- Computed ---
  const totalRemaining = adAccounts?.reduce((s: number, a: any) => s + Math.max(0, Number(a.spend_cap) - Number(a.amount_spent)), 0) ?? 0;
  // Total Spending query (period-based from Meta for accurate range totals)
  // Period spend from client_daily_stats (no Meta API call)
  const { data: periodSpendData } = useQuery({
    queryKey: [
      "client-period-spend",
      user?.id,
      totalSpendPeriod,
      format(totalSpendFrom, "yyyy-MM-dd"),
      format(totalSpendTo, "yyyy-MM-dd"),
    ],
    queryFn: async () => {
      if (totalSpendPeriod === "alltime") return null;
      const { data } = await (supabase as any).from("client_daily_stats")
        .select("total_spend")
        .eq("user_id", user!.id)
        .gte("stat_date", format(totalSpendFrom, "yyyy-MM-dd"))
        .lte("stat_date", format(totalSpendTo, "yyyy-MM-dd"));
      return (data ?? []).reduce((s: number, r: any) => s + Number(r.total_spend ?? 0), 0);
    },
    enabled: !!user && totalSpendPeriod !== "alltime",
    staleTime: 60_000,
  });

  const totalSpent = adAccounts?.reduce((s: number, a: any) => s + Number(a.amount_spent), 0) ?? 0;
  const displayTotalSpend = totalSpendPeriod === "alltime" ? totalSpent : (periodSpendData ?? 0);
  const totalSpendLabel = totalSpendPeriod === "alltime" ? "Total Spend (All)" : totalSpendPeriod === "month" ? `Spend (${format(new Date(), "MMM")})` : `Spend (${format(totalSpendFrom, "MMM d")}-${format(totalSpendTo, "d")})`;

  const todaySpend = (allInsights as any[])?.reduce((s: number, i: any) => s + Number(i.today_spend ?? 0), 0) ?? 0;
  const yesterdaySpend = (allInsights as any[])?.reduce((s: number, i: any) => s + Number(i.yesterday_spend ?? 0), 0) ?? 0;
  const todayOrders = (allInsights as any[])?.reduce((s: number, i: any) => s + Number(i.today_orders ?? 0), 0) ?? 0;
  const yesterdayOrders = (allInsights as any[])?.reduce((s: number, i: any) => s + Number(i.yesterday_orders ?? 0), 0) ?? 0;
  const totalCampaigns = (allInsights as any[])?.reduce((s: number, i: any) => s + Number(i.active_campaigns ?? 0), 0) ?? 0;

  // Spend vs Order chart data from daily stats
  const spendOrderData = useMemo(() => {
    if (!dailyStats || dailyStats.length === 0) {
      // Fallback to today/yesterday from insights
      const today = format(new Date(), "MMM d");
      const yesterday = format(subDays(new Date(), 1), "MMM d");
      return [
        { day: yesterday, spend: yesterdaySpend, orders: yesterdayOrders },
        { day: today, spend: todaySpend, orders: todayOrders },
      ];
    }
    return dailyStats.map((d: any) => ({
      day: format(parseISO(d.stat_date), "MMM d"),
      spend: Number(d.total_spend ?? 0),
      orders: Number(d.total_orders ?? 0),
    }));
  }, [dailyStats, todaySpend, yesterdaySpend, todayOrders, yesterdayOrders]);

  // Monthly top-up chart
  const monthlyChartData = useMemo(() => {
    if (!monthlyTopUps) return [];
    const grouped: Record<string, number> = {};
    for (let i = 5; i >= 0; i--) {
      const m = subMonths(new Date(), i);
      grouped[format(m, "MMM")] = 0;
    }
    (monthlyTopUps as any[]).forEach((t: any) => {
      const key = format(new Date(t.created_at), "MMM");
      if (grouped[key] !== undefined) grouped[key] += Number(t.amount);
    });
    return Object.entries(grouped).map(([month, amount]) => ({ month, amount }));
  }, [monthlyTopUps]);

  // Last vs this month
  const thisMonthTotal = useMemo(() => {
    const start = startOfMonth(new Date());
    return (monthlyTopUps as any[])?.filter((t: any) => new Date(t.created_at) >= start).reduce((s: number, t: any) => s + Number(t.amount), 0) ?? 0;
  }, [monthlyTopUps]);
  const lastMonthTotal = useMemo(() => {
    const start = startOfMonth(subMonths(new Date(), 1));
    const end = endOfMonth(subMonths(new Date(), 1));
    return (monthlyTopUps as any[])?.filter((t: any) => { const d = new Date(t.created_at); return d >= start && d <= end; }).reduce((s: number, t: any) => s + Number(t.amount), 0) ?? 0;
  }, [monthlyTopUps]);
  const percentChange = lastMonthTotal > 0 ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal * 100) : thisMonthTotal > 0 ? 100 : 0;

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    if (h < 21) return "Good evening";
    return "Good night";
  };

  const handleSpendCapIncrease = async () => {
    if (!topUpAccount || !topUpAmount) return;
    const amount = Number(topUpAmount);
    if (isNaN(amount) || amount <= 0) { toast.error("Enter a valid amount"); return; }
    const walletBalance = clientWallets.mainBalance;
    const dueLimit = Number((profile as any)?.due_limit ?? 0);
    if (walletBalance + dueLimit < amount) { toast.error("Insufficient wallet balance"); return; }
    setTopUpLoading(true);
    try {
      const res = await supabase.functions.invoke("spend-cap-update", {
        body: { ad_account_id: topUpAccount.id, amount, deduct_wallet: true, target_user_id: user!.id },
      });
      if (res.error || res.data?.error) { toast.error(friendlyEdgeError(res.error) || res.data?.error || "Failed"); return; }
      toast.success(`Spend cap increased by $${amount.toLocaleString()}`);
      const newSpendCap = Number(res.data?.new_spend_cap ?? 0);
      setTopUpAccount(null); setTopUpAmount("");
      // Wallet always invalidated (balance changed)
      queryClient.invalidateQueries({ queryKey: ["client-wallet"] });
      // Only update THIS account in cache — do not refetch the whole list
      // (avoids unnecessary load; other accounts are unchanged by this top-up)
      if (newSpendCap > 0) {
        queryClient.setQueryData(
          ["client-dashboard-ad-accounts", user?.id],
          (old: any[] | undefined) =>
            (old ?? []).map((a) =>
              a.id === topUpAccount.id ? { ...a, spend_cap: newSpendCap } : a,
            ),
        );
      }
    } catch (err: any) { toast.error(friendlyEdgeError(err)); } finally { setTopUpLoading(false); }
  };


  const spendOrderConfig = {
    spend: { label: "Spend ($)", color: "hsl(var(--chart-bar-start))" },
    orders: { label: "Orders", color: "hsl(var(--chart-3))" },
  };

  const topUpConfig = {
    amount: { label: "Top-Up ($)", color: "hsl(var(--primary))" },
  };

  const fmt = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between" data-tutorial="dashboard-welcome">
        <div>
          <h1 className="text-base md:text-lg font-bold text-foreground">
            {greeting()}, {profile?.full_name || "there"}! 👋
          </h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            {format(new Date(), "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px] rounded-md gap-1" onClick={() => setShowAdReqForm(true)}>
            <Plus className="h-3 w-3" />
            {isMobile ? "Request" : "Request Ad Account"}
          </Button>
          <Button size="sm" className="h-7 px-2.5 text-[11px] rounded-md gap-1" asChild>
            <Link to="/top-up"><Plus className="h-3 w-3" />Add Balance</Link>
          </Button>
        </div>
      </div>

      {/* Tutorial */}
      <TutorialButton />

      {/* Warnings */}
      {isInactive && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="p-3 flex items-center gap-3">
            <span className="text-destructive font-semibold text-sm">⚠️ Your account has been frozen. You cannot perform any transactions.</span>
          </CardContent>
        </Card>
      )}
      {agencyHasInsufficientBalance && (
        <Card className="border-warning bg-warning/10">
          <CardContent className="p-3 flex items-center gap-3">
            <span className="text-warning font-semibold text-sm">⚠️ Agency has insufficient balance. Contact admin.</span>
          </CardContent>
        </Card>
      )}

      {/* PWA Install */}
      {!isInstalled && !dismissedInstall && (
        <Card className="border-primary/30 bg-gradient-to-r from-primary/15 to-primary/5 relative overflow-hidden">
          <button onClick={() => { setDismissedInstall(true); localStorage.setItem("pwa-install-dismissed", "true"); }} className="absolute top-2 right-2 p-1 rounded-full hover:bg-muted/60">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Smartphone className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">📱 Download Our App</p>
              <p className="text-xs text-muted-foreground mt-0.5">{isIOS ? "Install on your iPhone" : "Install for quick access"}</p>
            </div>
            <Button size="sm" className="gap-1.5 rounded-full px-4 flex-shrink-0" onClick={async () => { if (isIOS) setShowIOSGuide(true); else await promptInstall(); }}>
              <Download className="h-4 w-4" />Install
            </Button>
          </CardContent>
        </Card>
      )}

      {/* iOS Guide */}
      {showIOSGuide && (
        <Dialog open={showIOSGuide} onOpenChange={setShowIOSGuide}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Install on iPhone</DialogTitle><DialogDescription>Follow these steps:</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              {[["1", "Tap the Share button", <Share key="s" className="h-3 w-3" />], ["2", 'Scroll & tap "Add to Home Screen"', null], ["3", 'Tap "Add" to install', null]].map(([n, t, icon]) => (
                <div key={String(n)} className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-bold text-primary">{n}</div>
                  <p className="text-sm font-medium flex items-center gap-1">{t as string} {icon}</p>
                </div>
              ))}
            </div>
            <DialogFooter><Button onClick={() => setShowIOSGuide(false)} className="w-full">Got it!</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Card Due Box — only shows if configured */}
      {user && cardDueVisibleForClient && <CardDueBox userId={user.id} size="sm" />}

      {/* Secondary wallet + combined BDT total — only when enabled for this client */}
      {clientWallets.secondaryEnabled && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <Card className="border-border/60 bg-card">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-green-700 dark:text-green-400">Secondary Wallet</p>
              <p className="text-2xl font-bold mt-1 text-green-700 dark:text-green-300">
                ${clientWallets.secondaryBalance.toLocaleString()}
              </p>
              <p className="text-[11px] text-green-700/70 dark:text-green-400/70 mt-0.5">
                Rate ৳{clientWallets.secondaryRate}/USD
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-purple-700 dark:text-purple-400">Combined Due / Adv</p>
              <p className="text-2xl font-bold mt-1 text-purple-700 dark:text-purple-300">
                {clientWallets.totalBdt < 0 ? "-" : ""}{formatBdt(clientWallets.totalBdt)}
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-purple-700/70 dark:text-purple-400/70">
                  {clientWallets.totalBdt < 0 ? "Due" : "Adv"}
                </span>
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Main ${clientWallets.mainBalance.toLocaleString()} × ৳{clientWallets.mainRate} + Secondary ${clientWallets.secondaryBalance.toLocaleString()} × ৳{clientWallets.secondaryRate}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========== METRIC CARDS ========== */}
      {isMobile ? (
        <div className="space-y-3">
          {/* Wallet Hero */}
          <div data-tutorial="card-wallet" className="rounded-2xl bg-gradient-to-br from-primary via-primary/85 to-primary/65 p-5 text-primary-foreground shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-90">Wallet Balance</p>
                <p className="text-3xl font-bold tracking-tight mt-1">{fmt(clientWallets.mainBalance)}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center"><Wallet className="h-6 w-6" /></div>
            </div>
          </div>
          {/* 3x2 grid */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Ad Accounts", value: String(adAccounts?.length ?? 0), key: "ad-accounts" },
              { label: dashboardSyncing ? "Remaining (syncing)" : "Remaining", value: fmt(totalRemaining), key: "remaining" },
              { label: "Today Spend", value: fmt(todaySpend), key: "today-spend" },
              { label: "Today Orders", value: String(todayOrders), key: "today-orders" },
              { label: "Total Top-Up", value: fmt(Number(topUpTotal ?? 0)), key: "total-topup" },
            ].map((m) => (
              <Card key={m.label} data-tutorial={`card-${m.key}`} className="bg-card border border-border/60">
                <CardContent className="p-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground font-medium truncate">{m.label}</p>
                  <p className="text-base font-bold text-foreground">{m.value}</p>
                </CardContent>
              </Card>
            ))}
            {/* Total Spend inside grid */}
            <Card data-tutorial="card-total-spend" className="bg-card border border-border/60">
              <CardContent className="p-2.5 text-center relative">
                <p className="text-[10px] text-muted-foreground font-medium truncate">{totalSpendLabel}</p>
                <p className="text-base font-bold text-foreground">{fmt(displayTotalSpend)}</p>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded hover:bg-muted/60">
                      <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-2" align="end">
                    <div className="flex flex-wrap gap-1 mb-2">
                      <Button size="sm" variant={totalSpendPeriod === "month" ? "default" : "outline"} className="h-6 text-[10px] px-2" onClick={() => { setTotalSpendPeriod("month"); setTotalSpendFrom(startOfMonth(new Date())); setTotalSpendTo(new Date()); }}>This Month</Button>
                      <Button size="sm" variant={totalSpendPeriod === "alltime" ? "default" : "outline"} className="h-6 text-[10px] px-2" onClick={() => setTotalSpendPeriod("alltime")}>All Time</Button>
                    </div>
                    <Calendar
                      mode="range"
                      selected={{ from: totalSpendFrom, to: totalSpendTo }}
                      onSelect={(range: any) => {
                        if (range?.from) { setTotalSpendFrom(range.from); setTotalSpendPeriod("custom"); }
                        if (range?.to) setTotalSpendTo(range.to);
                      }}
                      numberOfMonths={1}
                      className="p-2 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {/* Wallet - spanning */}
          <Card data-tutorial="card-wallet" className="col-span-2 lg:col-span-1 bg-gradient-to-br from-primary via-primary/85 to-primary/65 text-primary-foreground border-0 shadow-lg overflow-hidden relative">
            <CardContent className="p-5 relative z-10">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center"><Wallet className="h-5 w-5" /></div>
                <div>
                  <p className="text-xs opacity-80">Wallet Balance</p>
                  <p className="text-2xl font-bold tracking-tight">{fmt(clientWallets.mainBalance)}</p>
                </div>
              </div>
            </CardContent>
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
            <div className="absolute -right-2 -bottom-4 h-16 w-16 rounded-full bg-white/5" />
          </Card>

          {[
            { title: "Ad Accounts", value: String(adAccounts?.length ?? 0), icon: MonitorSmartphone, key: "ad-accounts" },
            { title: dashboardSyncing ? "Remaining (syncing)" : "Remaining", value: fmt(totalRemaining), icon: TrendingUp, key: "remaining" },
            { title: "Today Spend", value: fmt(todaySpend), icon: DollarSign, key: "today-spend" },
            { title: "Today Orders", value: String(todayOrders), icon: ShoppingCart, key: "today-orders" },
            { title: "Total Top-Up", value: fmt(Number(topUpTotal ?? 0)), icon: ArrowUpCircle, key: "total-topup" },
          ].map((m) => (
            <Card key={m.title} data-tutorial={`card-${m.key}`} className="border border-border/40 bg-primary/[0.04] dark:bg-primary/[0.08]">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10 dark:bg-primary/20">
                  <m.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground font-medium truncate">{m.title}</p>
                  <p className="text-lg font-bold text-foreground leading-tight">{m.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Total Spending with Calendar — inside grid */}
          <Card data-tutorial="card-total-spend" className="border border-border/40 bg-primary/[0.04] dark:bg-primary/[0.08]">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10 dark:bg-primary/20">
                <Activity className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground font-medium truncate">{totalSpendLabel}</p>
                <p className="text-lg font-bold text-foreground leading-tight">{fmt(displayTotalSpend)}</p>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2" align="end">
                  <div className="flex flex-wrap gap-1 mb-2">
                    <Button size="sm" variant={totalSpendPeriod === "month" ? "default" : "outline"} className="h-6 text-[10px] px-2" onClick={() => { setTotalSpendPeriod("month"); setTotalSpendFrom(startOfMonth(new Date())); setTotalSpendTo(new Date()); }}>This Month</Button>
                    <Button size="sm" variant={totalSpendPeriod === "alltime" ? "default" : "outline"} className="h-6 text-[10px] px-2" onClick={() => setTotalSpendPeriod("alltime")}>All Time</Button>
                  </div>
                  <Calendar
                    mode="range"
                    selected={{ from: totalSpendFrom, to: totalSpendTo }}
                    onSelect={(range: any) => {
                      if (range?.from) { setTotalSpendFrom(range.from); setTotalSpendPeriod("custom"); }
                      if (range?.to) setTotalSpendTo(range.to);
                    }}
                    numberOfMonths={1}
                    className="p-2 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========== DAILY ORDERS — COLUMN CHART ========== */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-primary" />
              Daily Orders
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 px-2">
                    <CalendarIcon className="h-3 w-3" />
                    {format(spendDateFrom, "MMM d")} – {format(spendDateTo, "MMM d")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="range"
                    selected={{ from: spendDateFrom, to: spendDateTo }}
                    onSelect={(range: any) => {
                      if (range?.from) setSpendDateFrom(range.from);
                      if (range?.to) setSpendDateTo(range.to);
                    }}
                    numberOfMonths={isMobile ? 1 : 2}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {spendOrderData.length > 0 ? (
            <ChartContainer config={spendOrderConfig} className="h-[260px] w-full">
              <BarChart data={spendOrderData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="ordersBarGradientV2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-bar-start))" />
                    <stop offset="100%" stopColor="hsl(var(--chart-bar-end))" />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval={spendOrderData.length > 15 ? Math.floor(spendOrderData.length / 8) : 0} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <RTooltip
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                  contentStyle={{
                    backgroundColor: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                />
                <Bar dataKey="orders" fill="url(#ordersBarGradientV2)" radius={[4, 4, 0, 0]} maxBarSize={isMobile ? 18 : 32} name="Orders" />
              </BarChart>
            </ChartContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
              No data for selected period.
            </div>
          )}
          <div className="rounded-lg bg-primary/[0.06] dark:bg-primary/[0.12] p-3 border border-primary/20 mt-4">
            <p className="text-[10px] text-muted-foreground font-medium">Total Orders (Period)</p>
            <p className="text-lg font-bold text-primary">{spendOrderData.reduce((s: number, d: any) => s + d.orders, 0).toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">{spendOrderData.length} days</p>
          </div>
        </CardContent>
      </Card>

      {/* ========== DAILY SPEND — AREA CHART ========== */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              Daily Spend
            </CardTitle>
            <span className="text-[10px] text-muted-foreground">{format(spendDateFrom, "MMM d")} – {format(spendDateTo, "MMM d")}</span>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {spendOrderData.length > 0 ? (
            <ChartContainer config={spendOrderConfig} className="h-[260px] w-full">
              <AreaChart data={spendOrderData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="dailySpendArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval={spendOrderData.length > 15 ? Math.floor(spendOrderData.length / 8) : 0} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                <RTooltip
                  cursor={{ stroke: "hsl(var(--primary))", strokeWidth: 1, strokeDasharray: "3 3" }}
                  contentStyle={{
                    backgroundColor: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                  formatter={(v: any) => [`$${Number(v).toLocaleString()}`, "Spend"]}
                />
                <Area
                  type="monotone"
                  dataKey="spend"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#dailySpendArea)"
                  dot={false}
                  activeDot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 0 }}
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
              No data for selected period.
            </div>
          )}
          <div className="rounded-lg bg-primary/[0.06] dark:bg-primary/[0.12] p-3 border border-primary/20 mt-4">
            <p className="text-[10px] text-muted-foreground font-medium">Total Spend (Period)</p>
            <p className="text-lg font-bold text-primary">{fmt(spendOrderData.reduce((s: number, d: any) => s + d.spend, 0))}</p>
            <p className="text-[10px] text-muted-foreground">{spendOrderData.length} days</p>
          </div>
        </CardContent>
      </Card>

      {/* ========== MONTHLY TOP-UP CHART ========== */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Monthly Top-Up Trend
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", percentChange >= 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                {percentChange >= 0 ? "▲" : "▼"} {Math.abs(percentChange).toFixed(0)}%
              </span>
              <span className="text-[10px] text-muted-foreground">vs last month</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {monthlyChartData.length > 0 ? (
            <ChartContainer config={topUpConfig} className="h-[200px] w-full">
              <AreaChart data={monthlyChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="topUpGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="amount" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#topUpGrad)" dot={{ r: 4, fill: "hsl(var(--primary))" }} />
              </AreaChart>
            </ChartContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">No top-up data</div>
          )}
          {/* Last vs This month */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="rounded-lg bg-muted/50 p-3 border border-border/40">
              <p className="text-[10px] text-muted-foreground font-medium">Last Month</p>
              <p className="text-lg font-bold text-foreground">{fmt(lastMonthTotal)}</p>
              <p className="text-[10px] text-muted-foreground">{format(subMonths(new Date(), 1), "MMMM yyyy")}</p>
            </div>
            <div className="rounded-lg bg-primary/[0.06] dark:bg-primary/[0.12] p-3 border border-primary/20">
              <p className="text-[10px] text-muted-foreground font-medium">This Month</p>
              <p className="text-lg font-bold text-primary">{fmt(thisMonthTotal)}</p>
              <p className="text-[10px] text-muted-foreground">{format(new Date(), "MMMM yyyy")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ========== DIALOGS ========== */}
      <Dialog open={showAdReqForm} onOpenChange={setShowAdReqForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Request New Ad Account</DialogTitle><DialogDescription>Fill in details to request a new ad account.</DialogDescription></DialogHeader>
          <div className="space-y-3 py-2">
            <div><label className="text-sm font-medium mb-1 block">Account Name *</label><Input value={adReqForm.account_name} onChange={(e) => setAdReqForm(f => ({ ...f, account_name: e.target.value }))} placeholder="e.g. My Store Ads" /></div>
            <div><label className="text-sm font-medium mb-1 block">Email *</label><Input type="email" value={adReqForm.email} onChange={(e) => setAdReqForm(f => ({ ...f, email: e.target.value }))} placeholder="your@email.com" /></div>
            <div><label className="text-sm font-medium mb-1 block">Business Manager ID *</label><Input value={adReqForm.business_manager_id} onChange={(e) => setAdReqForm(f => ({ ...f, business_manager_id: e.target.value }))} placeholder="e.g. 123456789" /></div>
            <div><label className="text-sm font-medium mb-1 block">Monthly Approx Spending</label><Input value={adReqForm.monthly_spend} onChange={(e) => setAdReqForm(f => ({ ...f, monthly_spend: e.target.value }))} placeholder="e.g. $500" /></div>
            <div><label className="text-sm font-medium mb-1 block">When will you start ads?</label><Input type="date" value={adReqForm.start_date} onChange={(e) => setAdReqForm(f => ({ ...f, start_date: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdReqForm(false)}>Cancel</Button>
            <Button onClick={handleAdReqSubmit} disabled={adReqLoading}>{adReqLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Submit Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!topUpAccount} onOpenChange={(o) => { if (!o) setTopUpAccount(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Increase Spend Cap</DialogTitle><DialogDescription>Top up <span className="font-medium text-foreground">{topUpAccount?.account_name}</span></DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex justify-between items-center text-sm p-3 rounded-lg bg-muted"><span className="text-muted-foreground">Wallet</span><span className="font-semibold">{fmt(clientWallets.mainBalance)}</span></div>
            {Number((profile as any)?.due_limit ?? 0) > 0 && (
              <div className="flex justify-between items-center text-sm p-3 rounded-lg bg-warning/10 border border-warning/30">
                <span className="text-warning">Due Limit</span><span className="font-semibold text-warning">{fmt(Number((profile as any)?.due_limit ?? 0))}</span>
              </div>
            )}
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Current Spend Cap</span><span className="font-semibold">{fmt(Number(topUpAccount?.spend_cap ?? 0))}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Amount Spent</span><span className="font-semibold">{fmt(Number(topUpAccount?.amount_spent ?? 0))}</span></div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Amount (USD)</label>
              <Input type="number" min="1" placeholder="Enter amount" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} autoFocus />
              {topUpAmount && Number(topUpAmount) > 0 && (
                <p className="text-xs text-muted-foreground mt-1">New cap: <span className="font-medium text-foreground">{fmt(Number(topUpAccount?.spend_cap ?? 0) + Number(topUpAmount))}</span></p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopUpAccount(null)} disabled={topUpLoading}>Cancel</Button>
            <Button onClick={handleSpendCapIncrease} disabled={topUpLoading || !topUpAmount || Number(topUpAmount) <= 0} className="bg-gradient-to-r from-primary to-primary/80 text-primary-foreground">
              {topUpLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ArrowUpCircle className="h-4 w-4 mr-1" />}Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
