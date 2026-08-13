import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { MetricCard } from "@/components/MetricCard";
import { Users, Wallet, Clock, Activity, Ban, TrendingUp, Trophy, Crown, Medal, RefreshCw, CalendarIcon, ChevronLeft, ChevronRight, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths, addMonths, eachDayOfInterval, isFuture, min } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import { useIsMobile } from "@/hooks/use-mobile";
import { fetchSpendOnly, type RateLimitedDetail } from "@/lib/fetchSpendOnly";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";


const DATE_PRESETS = [
  { label: "Today", getValue: () => ({ from: new Date(), to: new Date() }) },
  { label: "Yesterday", getValue: () => ({ from: subDays(new Date(), 1), to: subDays(new Date(), 1) }) },
  { label: "Last 7 days", getValue: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
  { label: "Last 14 days", getValue: () => ({ from: subDays(new Date(), 13), to: new Date() }) },
  { label: "Last 28 days", getValue: () => ({ from: subDays(new Date(), 27), to: new Date() }) },
  { label: "Last 30 days", getValue: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
  { label: "This week", getValue: () => ({ from: startOfWeek(new Date(), { weekStartsOn: 1 }), to: new Date() }) },
  { label: "Last week", getValue: () => ({ from: startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }), to: endOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }) }) },
  { label: "This month", getValue: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: "Last month", getValue: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
];

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--primary) / 0.7)",
  "hsl(var(--primary) / 0.5)",
  "hsl(var(--chart-2) / 0.7)",
  "hsl(var(--chart-3) / 0.7)",
  "hsl(var(--primary) / 0.4)",
];

const SPEND_SESSION_KEY = "admin-dashboard-spend";
const DATE_SPEND_SESSION_KEY = "admin-dashboard-date-spend";

export function AdminDashboard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [metaLoading, setMetaLoading] = useState(false);
  const [dailySpendLoading, setDailySpendLoading] = useState(false);
  const [metaSyncStatus, setMetaSyncStatus] = useState<{ total: number; success: number; failed: number; autoRetried: number } | null>(null);
  const [monthSyncLoading, setMonthSyncLoading] = useState(false);
  const [graphMonth, setGraphMonth] = useState(new Date());
  const [monthSyncCalls, setMonthSyncCalls] = useState<number | null>(null);
  const [dateSpendCalls, setDateSpendCalls] = useState<number | null>(null);
  const [dateSpendProxyIp, setDateSpendProxyIp] = useState<string | null>(null);
  const [dateSpendCached, setDateSpendCached] = useState<boolean>(() => {
    try {
      return !!sessionStorage.getItem(DATE_SPEND_SESSION_KEY);
    } catch { return false; }
  });
  const [tenantTestMode, setTenantTestMode] = useState(() => {
    try { return localStorage.getItem("tenant_test_mode") === "true"; } catch { return false; }
  });

  const [spendData, setSpendData] = useState<{ today: number; yesterday: number } | null>(() => {
    try {
      const stored = sessionStorage.getItem(SPEND_SESSION_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [selectedPreset, setSelectedPreset] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dateSpend, setDateSpend] = useState<number | null>(() => {
    try {
      const stored = sessionStorage.getItem(DATE_SPEND_SESSION_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      return parsed.spend ?? null;
    } catch { return null; }
  });
  const [dateSpendRange, setDateSpendRange] = useState<{ from: string; to: string } | null>(() => {
    try {
      const stored = sessionStorage.getItem(DATE_SPEND_SESSION_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (!parsed.dateFrom || !parsed.dateTo) return null;
      return {
        from: format(new Date(parsed.dateFrom), "yyyy-MM-dd"),
        to: format(new Date(parsed.dateTo), "yyyy-MM-dd"),
      };
    } catch { return null; }
  });
  const [dateSpendLoading, setDateSpendLoading] = useState(false);
  const [rateLimitedDetails, setRateLimitedDetails] = useState<RateLimitedDetail[]>([]);
  const [rateLimitedDialogOpen, setRateLimitedDialogOpen] = useState(false);
  const [rateLimitedSource, setRateLimitedSource] = useState<string>("");

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(DATE_SPEND_SESSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.dateFrom && parsed.dateTo) {
          setDateRange({ from: new Date(parsed.dateFrom), to: new Date(parsed.dateTo) });
        }
      }
    } catch { /* ignore */ }
  }, []);

  const { data: profiles } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email, status");
      return (data as any[]) ?? [];
    },
    staleTime: 10 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: wallets } = useQuery({
    queryKey: ["admin-wallets"],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("user_id, balance");
      return (data as any[]) ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: pendingRequests } = useQuery({
    queryKey: ["admin-pending-topups"],
    queryFn: async () => {
      const { data, error } = await supabase.from("top_up_requests").select("id").eq("status", "pending");
      if (error) console.error("Pending top-ups error:", error);
      return (data as any[]) ?? [];
    },
    staleTime: 10 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: adAccounts } = useQuery({
    queryKey: ["admin-ad-accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("ad_accounts").select("id, account_name, status, spend_cap, amount_spent, account_id");
      return (data as any[]) ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: userAdAccounts } = useQuery({
    queryKey: ["admin-user-ad-accounts"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("user_ad_accounts").select("user_id, ad_account_id");
      return (data as any[]) ?? [];
    },
    staleTime: 10 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // License config (for tenant mode)
  const { data: licenseConfig } = useQuery({
    queryKey: ["dashboard-license-config"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("key, value").in("key", [
        "is_tenant", "master_url", "license_status", "license_system_limit",
        "license_total_used", "license_subscription_type", "license_subscription_paid_until",
      ]);
      const map: Record<string, string> = {};
      if (data) for (const r of data) map[r.key] = r.value || "";
      return map;
    },
    staleTime: 5 * 60_000,
  });

  const isTenantMode = licenseConfig?.is_tenant === "true" || !!licenseConfig?.master_url || tenantTestMode;

  const mockLicenseConfig = tenantTestMode && !licenseConfig?.master_url ? {
    license_status: "active",
    license_subscription_type: "subscription_with_limit",
    license_system_limit: "5000",
    license_total_used: "1250",
    license_subscription_paid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  } : null;

  const effectiveLicense = mockLicenseConfig || licenseConfig;
  // Monthly spend graph — from daily_spend_snapshots (Meta API data)
  const { data: monthlySpendData } = useQuery({
    queryKey: ["admin-monthly-spend-graph", format(graphMonth, "yyyy-MM")],
    queryFn: async () => {
      const monthStart = startOfMonth(graphMonth);
      const monthEnd = min([endOfMonth(graphMonth), new Date()]);
      const fromStr = format(monthStart, "yyyy-MM-dd");
      const toStr = format(monthEnd, "yyyy-MM-dd");
      const { data } = await (supabase as any)
        .from("daily_spend_snapshots")
        .select("snapshot_date, total_spend")
        .gte("snapshot_date", fromStr)
        .lte("snapshot_date", toStr)
        .order("snapshot_date", { ascending: true });

      const dayMap: Record<string, number> = {};
      (data ?? []).forEach((r: any) => {
        dayMap[r.snapshot_date] = Number(r.total_spend);
      });

      const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
      return days.map(d => {
        const key = format(d, "yyyy-MM-dd");
        return {
          date: format(d, "MMM d"),
          spend: Math.round((dayMap[key] || 0) * 100) / 100,
        };
      });
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // Realtime subscription removed for performance — data refreshes only via manual actions
  // (Update from Meta button, top-up actions, page reload).

  const totalBalance = wallets?.reduce((sum: number, w: any) => sum + Number(w.balance), 0) ?? 0;
  const activeAccounts = adAccounts?.filter((a: any) => a.status === "active") ?? [];
  const disabledAccounts = adAccounts?.filter((a: any) => a.status !== "active") ?? [];
  const remainingLimit = adAccounts?.reduce((sum: number, a: any) => sum + Math.max(0, Number(a.spend_cap) - Number(a.amount_spent)), 0) ?? 0;

  // Top Spenders — proxy-based live fetch (Spend Report style), persisted snapshot.
  type TopSpenderSnapshot = {
    from: string;
    to: string;
    rows: { user_id: string; total: number }[];
    meta_calls: number;
    proxy_ip: string | null;
    fetched_at: string;
  };
  const TOP_SPENDER_STORAGE_KEY = "admin-dashboard-top-spenders:v1";
  const [topSpenderSnapshot, setTopSpenderSnapshot] = useState<TopSpenderSnapshot | null>(() => {
    try {
      const raw = localStorage.getItem(TOP_SPENDER_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as TopSpenderSnapshot) : null;
    } catch { return null; }
  });
  const [topSpenderRange, setTopSpenderRange] = useState<DateRange | undefined>(() => {
    try {
      const raw = localStorage.getItem(TOP_SPENDER_STORAGE_KEY);
      if (raw) {
        const snap = JSON.parse(raw) as TopSpenderSnapshot;
        return { from: new Date(snap.from), to: new Date(snap.to) };
      }
    } catch { /* ignore */ }
    return { from: startOfMonth(new Date()), to: new Date() };
  });
  const [topSpenderPreset, setTopSpenderPreset] = useState<string>(() => {
    try {
      return localStorage.getItem(TOP_SPENDER_STORAGE_KEY) ? "" : "This month";
    } catch { return "This month"; }
  });
  const [topSpenderPickerOpen, setTopSpenderPickerOpen] = useState(false);
  const [topSpenderFetching, setTopSpenderFetching] = useState(false);

  const topSpenderFromStr = topSpenderRange?.from ? format(topSpenderRange.from, "yyyy-MM-dd") : null;
  const topSpenderToStr = topSpenderRange?.to ? format(topSpenderRange.to, "yyyy-MM-dd") : null;
  const topSpenderRangeMatchesSnapshot = !!topSpenderSnapshot &&
    topSpenderFromStr === topSpenderSnapshot.from &&
    topSpenderToStr === topSpenderSnapshot.to;

  const handleUpdateTopSpenders = async () => {
    if (!topSpenderFromStr || !topSpenderToStr || topSpenderFetching) return;
    if (!userAdAccounts?.length) {
      toast.error("No ad account assignments loaded yet.");
      return;
    }
    setTopSpenderFetching(true);
    try {
      // Map ad_account_id → first assigned user (dedupe so each account counts once)
      const accountToUser: Record<string, string> = {};
      userAdAccounts.forEach((ua: any) => {
        if (!accountToUser[ua.ad_account_id]) accountToUser[ua.ad_account_id] = ua.user_id;
      });
      const allAccountIds = Object.keys(accountToUser);
      if (!allAccountIds.length) {
        toast.error("No ad accounts assigned to clients.");
        setTopSpenderFetching(false);
        return;
      }
      const { spend, meta_calls, proxy_ip } = await fetchSpendOnly(allAccountIds, {
        date_from: topSpenderFromStr,
        date_to: topSpenderToStr,
      });
      const byUser: Record<string, number> = {};
      Object.entries(spend).forEach(([accId, amount]) => {
        const uid = accountToUser[accId];
        if (!uid) return;
        byUser[uid] = (byUser[uid] || 0) + Number(amount || 0);
      });
      const rows = Object.entries(byUser).map(([user_id, total]) => ({
        user_id,
        total: Math.round(total * 100) / 100,
      }));
      const next: TopSpenderSnapshot = {
        from: topSpenderFromStr,
        to: topSpenderToStr,
        rows,
        meta_calls: meta_calls ?? 0,
        proxy_ip: proxy_ip ?? null,
        fetched_at: new Date().toISOString(),
      };
      setTopSpenderSnapshot(next);
      try { localStorage.setItem(TOP_SPENDER_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      toast.success(`Updated · ${meta_calls} Meta calls${proxy_ip ? ` · ${proxy_ip}` : ""}`);
    } catch (err: any) {
      toast.error("Failed to fetch spend: " + (err?.message || "Unknown error"));
    } finally {
      setTopSpenderFetching(false);
    }
  };

  const { spenderChart, topThree } = useMemo(() => {
    if (!topSpenderSnapshot || !profiles?.length) return { spenderChart: [], topThree: [] };
    const profileMap: Record<string, any> = {};
    profiles.forEach((p: any) => { profileMap[p.user_id] = p; });
    const sorted = topSpenderSnapshot.rows
      .filter(r => r.total > 0)
      .map(r => ({
        userId: r.user_id,
        name: profileMap[r.user_id]?.full_name || profileMap[r.user_id]?.email || "Unknown",
        value: r.total,
      }))
      .sort((a, b) => b.value - a.value);
    return { spenderChart: sorted.slice(0, 8), topThree: sorted.slice(0, 3) };
  }, [topSpenderSnapshot, profiles]);

  const handleUpdateFromMeta = async () => {
    if (!adAccounts?.length) return;
    setMetaLoading(true);
    try {
      const ids = adAccounts.map((a: any) => a.id);
      const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
      const result = await chunkedMetaSync(ids);

      // Save today's spend snapshot from insights
      const insights = result.insights ?? {};
      const todaySpend = Object.values(insights).reduce((sum: number, ins: any) => sum + (Number(ins?.today_spend) || 0), 0) as number;
      const yesterdaySpend = Object.values(insights).reduce((sum: number, ins: any) => sum + (Number(ins?.yesterday_spend) || 0), 0) as number;
      const todayStr = format(new Date(), "yyyy-MM-dd");
      const yesterdayStr = format(subDays(new Date(), 1), "yyyy-MM-dd");
      await Promise.all([
        saveSpendSnapshot(todayStr, todaySpend, ids.length),
        saveSpendSnapshot(yesterdayStr, yesterdaySpend, ids.length),
      ]);

      queryClient.invalidateQueries({ queryKey: ["billings-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["billings-insights"] });
      queryClient.invalidateQueries({ queryKey: ["admin-monthly-spend-graph"] });
      // Populate client_daily_stats for all users after Meta sync
      import("@/lib/populateDailyStats").then(m => m.populateClientDailyStats()).catch(console.error);
      const failed = result.failed_account_ids?.length ?? 0;
      const attempted = result.attempted ?? ids.length;
      const succeeded = result.succeeded ?? (attempted - failed);
      const autoRetried = result.auto_retried ?? 0;
      setMetaSyncStatus({ total: attempted, success: succeeded, failed, autoRetried });
      if (failed > 0) {
        toast.warning(`⚠️ ${succeeded}/${attempted} updated · ${failed} failed — click Update again to retry`);
      } else if (autoRetried > 0) {
        toast.success(`Meta data updated (${autoRetried} auto-retried successfully)`);
      } else {
        toast.success("Meta data updated successfully");
      }
    } catch (err: any) {
      toast.error("Failed to update from Meta: " + (err.message || "Unknown error"));
    } finally {
      setMetaLoading(false);
    }
  };

  const saveSpendSnapshot = async (dateStr: string, totalSpend: number, accountCount: number) => {
    try {
      await (supabase as any).from("daily_spend_snapshots").upsert(
        { snapshot_date: dateStr, total_spend: totalSpend, account_count: accountCount },
        { onConflict: "snapshot_date" }
      );
    } catch (err) {
      console.error("Failed to save spend snapshot:", err);
    }
  };

  const handleFetchDailySpend = async () => {
    if (!adAccounts?.length) return;
    setDailySpendLoading(true);
    try {
      const ids = adAccounts.map((a: any) => a.id);
      const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
      const result = await chunkedMetaSync(ids);
      const insights = result.insights ?? {};
      const today = Object.values(insights).reduce((sum: number, ins: any) => sum + (Number(ins?.today_spend) || 0), 0) as number;
      const yesterday = Object.values(insights).reduce((sum: number, ins: any) => sum + (Number(ins?.yesterday_spend) || 0), 0) as number;
      const newSpend = { today, yesterday };
      setSpendData(newSpend);
      sessionStorage.setItem(SPEND_SESSION_KEY, JSON.stringify(newSpend));

      // Save snapshots to database
      const todayStr = format(new Date(), "yyyy-MM-dd");
      const yesterdayStr = format(subDays(new Date(), 1), "yyyy-MM-dd");
      await Promise.all([
        saveSpendSnapshot(todayStr, today, ids.length),
        saveSpendSnapshot(yesterdayStr, yesterday, ids.length),
      ]);

      queryClient.invalidateQueries({ queryKey: ["admin-monthly-spend-graph"] });
    } catch (err: any) {
      toast.error("Failed to fetch daily spend: " + (err.message || "Unknown error"));
    } finally {
      setDailySpendLoading(false);
    }
  };

  const handleFetchDateRangeSpend = async () => {
    if (!adAccounts?.length || !dateRange?.from || !dateRange?.to) return;
    setDateSpendLoading(true);
    try {
      const ids = adAccounts.map((a: any) => a.id);
      const fromStr = format(dateRange.from, "yyyy-MM-dd");
      const toStr = format(dateRange.to, "yyyy-MM-dd");
      // Lightweight spend-only batch call (1 HTTP request per 50 accounts).
      const { fetchSpendOnly } = await import("@/lib/fetchSpendOnly");
      const result = await fetchSpendOnly(ids, { date_from: fromStr, date_to: toStr });
      if (result.rate_limited.length) {
        setRateLimitedDetails(result.rate_limited_details ?? []);
        setRateLimitedSource(`${fromStr} → ${toStr}`);
        toast.warning(`Rate limited on ${result.rate_limited.length} account(s). Results may be partial.`, {
          action: { label: "View", onClick: () => setRateLimitedDialogOpen(true) },
          duration: 10000,
        });
      } else {
        setRateLimitedDetails([]);
      }
      const total = result.total;
      setDateSpend(total);
      setDateSpendRange({ from: fromStr, to: toStr });
      setDateSpendCalls(result.meta_calls ?? null);
      setDateSpendProxyIp(result.proxy_ip ?? null);
      setDateSpendCached(false);
      sessionStorage.setItem(DATE_SPEND_SESSION_KEY, JSON.stringify({
        spend: total,
        dateFrom: dateRange.from.toISOString(),
        dateTo: dateRange.to.toISOString(),
      }));

      // Daily snapshots are now persisted server-side inside get-spend-only
      // (service role bypasses RLS, so writes always succeed). We just need
      // to refresh the chart for any month touched by this date range.
      try {
        const months = new Set<string>();
        Object.values(result.daily ?? {}).forEach((days: any) => {
          for (const d of days || []) {
            if (d?.date) months.add(String(d.date).slice(0, 7));
          }
        });
        for (const m of months) {
          await queryClient.invalidateQueries({ queryKey: ["admin-monthly-spend-graph", m] });
        }
      } catch (e) {
        console.warn("Graph refresh failed:", e);
      }

      setPickerOpen(false);
    } catch (err: any) {
      console.error("Date range spend error:", err);
      toast.error("Failed to fetch spend: " + (err.message || "Unknown error"));
    } finally {
      setDateSpendLoading(false);
    }
  };

  const handleSyncMonthSpend = async () => {
    if (!adAccounts?.length) return;
    setMonthSyncLoading(true);
    try {
      const ids = adAccounts.map((a: any) => a.id);
      const monthStart = startOfMonth(graphMonth);
      const monthEnd = min([endOfMonth(graphMonth), new Date()]);
      const fromStr = format(monthStart, "yyyy-MM-dd");
      const toStr = format(monthEnd, "yyyy-MM-dd");
      // Lightweight batch call — only `spend` field, ~50 accounts per HTTP request.
      const { fetchSpendOnly } = await import("@/lib/fetchSpendOnly");
      const result = await fetchSpendOnly(ids, { date_from: fromStr, date_to: toStr });
      if (result.rate_limited.length) {
        setRateLimitedDetails(result.rate_limited_details ?? []);
        setRateLimitedSource(`${format(graphMonth, "MMM yyyy")} sync`);
        toast.warning(`Rate limited on ${result.rate_limited.length} account(s).`, {
          action: { label: "View", onClick: () => setRateLimitedDialogOpen(true) },
          duration: 10000,
        });
      }
      setMonthSyncCalls(result.meta_calls ?? null);

      // Aggregate per-day spend across all accounts for the chart bars
      const dailyMap: Record<string, number> = {};
      Object.values(result.daily).forEach((days) => {
        for (const d of days) {
          if (d?.date) dailyMap[d.date] = (dailyMap[d.date] || 0) + (Number(d.spend) || 0);
        }
      });

      const snapshotEntries = Object.entries(dailyMap);
      if (snapshotEntries.length > 0) {
        const batchSize = 30;
        for (let i = 0; i < snapshotEntries.length; i += batchSize) {
          const batch = snapshotEntries.slice(i, i + batchSize).map(([date, spend]) => ({
            snapshot_date: date,
            total_spend: Math.round(spend * 100) / 100,
            account_count: ids.length,
          }));
          await (supabase as any).from("daily_spend_snapshots").upsert(batch, { onConflict: "snapshot_date" });
        }
      }

      await queryClient.invalidateQueries({ queryKey: ["admin-monthly-spend-graph", format(graphMonth, "yyyy-MM")] });
      toast.success(`Synced ${snapshotEntries.length} days of spend data`);
    } catch (err: any) {
      toast.error("Failed to sync month: " + (err.message || "Unknown error"));
    } finally {
      setMonthSyncLoading(false);
    }
  };

  const handlePresetChange = (presetLabel: string) => {
    setSelectedPreset(presetLabel);
    const preset = DATE_PRESETS.find(p => p.label === presetLabel);
    if (preset) {
      const range = preset.getValue();
      setDateRange({ from: range.from, to: range.to });
    }
  };

  const rankIcons = [Crown, Trophy, Medal];
  const rankColors = ["text-yellow-500", "text-blue-500", "text-orange-500"];

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold">Admin Dashboard</h1>
        <Button
          variant={tenantTestMode ? "default" : "outline"}
          size="sm"
          onClick={() => {
            const next = !tenantTestMode;
            setTenantTestMode(next);
            try { localStorage.setItem("tenant_test_mode", String(next)); } catch {}
            queryClient.invalidateQueries({ queryKey: ["is-tenant-mode-sidebar"] });
          }}
          className="text-xs gap-1.5"
        >
          <Shield className="h-3 w-3" />
          {tenantTestMode ? "Tenant Mode ✓" : "Master Mode"}
        </Button>
      </div>



      {/* License Status Widget (Tenant Mode) */}
      {isTenantMode && effectiveLicense && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">License Status</span>
              {mockLicenseConfig && <Badge variant="outline" className="text-xs">Test Mode</Badge>}
              <Badge variant={effectiveLicense.license_status === "active" ? "default" : "destructive"} className="ml-auto">
                {effectiveLicense.license_status || "Unknown"}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground text-xs">Type</span>
                <p className="font-medium">{effectiveLicense.license_subscription_type === "subscription_with_limit" ? "Subscription + Limit" : "Subscription Only"}</p>
              </div>
              {effectiveLicense.license_subscription_paid_until && (
                <div>
                  <span className="text-muted-foreground text-xs">Paid Until</span>
                  <p className="font-medium">{new Date(effectiveLicense.license_subscription_paid_until).toLocaleDateString()}</p>
                </div>
              )}
            </div>
            {effectiveLicense.license_subscription_type === "subscription_with_limit" && (
              <div className="mt-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">System Limit Used</span>
                  <span className="font-medium">
                    ${Number(effectiveLicense.license_total_used || 0).toLocaleString()} / ${Number(effectiveLicense.license_system_limit || 0).toLocaleString()}
                  </span>
                </div>
                <Progress
                  value={Number(effectiveLicense.license_system_limit) > 0
                    ? (Number(effectiveLicense.license_total_used || 0) / Number(effectiveLicense.license_system_limit)) * 100
                    : 0}
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  Remaining: ${(Number(effectiveLicense.license_system_limit || 0) - Number(effectiveLicense.license_total_used || 0)).toLocaleString()}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isMobile && (
        <Card className="bg-gradient-to-br from-primary to-primary/70 text-primary-foreground border-0 shadow-lg cursor-pointer hover:shadow-xl transition-shadow" onClick={() => navigate("/wallet-balances")}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs opacity-80">Platform Balance</p>
                <p className="text-2xl font-bold mt-0.5">${totalBalance.toLocaleString()}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                <Wallet className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className={cn(
        "grid gap-3",
        isMobile ? "grid-cols-3" : "grid-cols-2 md:gap-4 lg:grid-cols-3"
      )}>
        {!isMobile && (
          <div className="cursor-pointer" onClick={() => navigate("/wallet-balances")}>
            <MetricCard title="Platform Balance" value={`$${totalBalance.toLocaleString()}`} icon={Wallet} iconBg="bg-emerald-50 dark:bg-emerald-900/30" iconColor="text-emerald-600" />
          </div>
        )}
        <MetricCard title="Total Clients" value={profiles?.length ?? 0} icon={Users} iconBg="bg-blue-50 dark:bg-blue-900/30" iconColor="text-blue-600" size={isMobile ? "xs" : "default"} />
        <MetricCard title="Pending Top-Ups" value={pendingRequests?.length ?? 0} icon={Clock} iconBg="bg-amber-50 dark:bg-amber-900/30" iconColor="text-amber-600" size={isMobile ? "xs" : "default"} />
        <MetricCard title="Active Accounts" value={activeAccounts.length} icon={Activity} iconBg="bg-teal-50 dark:bg-teal-900/30" iconColor="text-teal-600" size={isMobile ? "xs" : "default"} />
        <MetricCard title="Disabled" value={disabledAccounts.length} icon={Ban} iconBg="bg-red-50 dark:bg-red-900/30" iconColor="text-red-500" size={isMobile ? "xs" : "default"} />
        <MetricCard title="Remaining Limit" value={`$${remainingLimit.toLocaleString()}`} icon={TrendingUp} iconBg="bg-violet-50 dark:bg-violet-900/30" iconColor="text-violet-600" size={isMobile ? "xs" : "default"} className={isMobile ? "col-span-2" : ""} />
      </div>

      {/* Spend Overview */}
      <Card>
        <CardContent className="py-3 md:py-4">
          <div className={cn("flex gap-3", isMobile ? "flex-col" : "flex-row items-center flex-wrap")}>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal gap-2 w-full sm:w-auto", !dateRange?.from && "text-muted-foreground")}>
                  <CalendarIcon className="h-4 w-4" />
                  {dateRange?.from && dateRange?.to
                    ? `${format(dateRange.from, "MMM d, yyyy")} – ${format(dateRange.to, "MMM d, yyyy")}`
                    : "Select date range"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start" side="bottom">
                {isMobile ? (
                  <div className="p-2 space-y-2 max-w-[320px]">
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Presets</p>
                      <RadioGroup value={selectedPreset} onValueChange={handlePresetChange} className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                        {DATE_PRESETS.map((preset) => (
                          <div key={preset.label} className="flex items-center space-x-1.5">
                            <RadioGroupItem value={preset.label} id={`preset-${preset.label}`} className="h-3 w-3" />
                            <Label htmlFor={`preset-${preset.label}`} className="text-xs cursor-pointer font-normal">{preset.label}</Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </div>
                    <Calendar
                      mode="range"
                      selected={dateRange}
                      onSelect={(range) => { setDateRange(range); setSelectedPreset(""); }}
                      numberOfMonths={1}
                      disabled={(d) => d > new Date()}
                      className="pointer-events-auto p-1 text-xs [&_table]:text-xs [&_td]:p-0 [&_th]:p-0 [&_td]:h-7 [&_td]:w-7 [&_th]:w-7 [&_button]:h-7 [&_button]:w-7 [&_button]:text-xs [&_.rdp-caption_label]:text-xs [&_.rdp-nav_button]:h-6 [&_.rdp-nav_button]:w-6"
                    />
                  </div>
                ) : (
                <div className="flex pointer-events-auto">
                  <div className="border-r p-3 space-y-1 min-w-[150px]">
                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Presets</p>
                    <RadioGroup value={selectedPreset} onValueChange={handlePresetChange}>
                      {DATE_PRESETS.map((preset) => (
                        <div key={preset.label} className="flex items-center space-x-2">
                          <RadioGroupItem value={preset.label} id={`preset-${preset.label}`} className="h-3.5 w-3.5" />
                          <Label htmlFor={`preset-${preset.label}`} className="text-sm cursor-pointer font-normal">
                            {preset.label}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                  <div className="p-3">
                    <Calendar
                      mode="range"
                      selected={dateRange}
                      onSelect={(range) => {
                        setDateRange(range);
                        setSelectedPreset("");
                      }}
                      numberOfMonths={2}
                      disabled={(d) => d > new Date()}
                      className="pointer-events-auto"
                    />
                  </div>
                </div>
                )}
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <div className="text-sm text-muted-foreground">
                    {dateRange?.from && dateRange?.to
                      ? `${format(dateRange.from, "MMM d, yyyy")} — ${format(dateRange.to, "MMM d, yyyy")}`
                      : "Select a range"}
                  </div>
                  <Button
                    size="sm"
                    onClick={handleFetchDateRangeSpend}
                    disabled={dateSpendLoading || !dateRange?.from || !dateRange?.to}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 mr-1 ${dateSpendLoading ? "animate-spin" : ""}`} />
                    {dateSpendLoading ? "Loading..." : "Update"}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            {(() => {
              const selFrom = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : null;
              const selTo = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : null;
              const rangeMatches =
                !!dateSpendRange && !!selFrom && !!selTo &&
                dateSpendRange.from === selFrom && dateSpendRange.to === selTo;
              const showValue = dateSpend !== null && rangeMatches;
              return (
            <div className="flex items-center gap-2">
              {!isMobile && <div className="h-8 w-px bg-border" />}
              <div>
                <p className="text-xs text-muted-foreground">
                  {dateRange?.from && dateRange?.to ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d, yyyy")}` : "Date Range"} Spend
                </p>
                <p className={cn("font-bold", isMobile ? "text-base" : "text-lg")}>
                  {dateSpendLoading
                    ? "Loading..."
                    : showValue
                      ? `$${dateSpend!.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : "—"}
                </p>
                {dateSpendCalls !== null && !dateSpendLoading && showValue && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Meta API calls: <span className="font-semibold text-foreground">{dateSpendCalls}</span>
                    {dateSpendProxyIp && <> · via {dateSpendProxyIp}</>}
                  </p>
                )}
                {!dateSpendLoading && !showValue && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Click "Update" to load spend for this range
                  </p>
                )}
                {dateSpendCached && showValue && !dateSpendLoading && dateSpendCalls === null && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    cached — click "Update" for live data
                  </p>
                )}
              </div>
            </div>
              );
            })()}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Monthly Spend Graph */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base md:text-lg flex items-center gap-2 flex-wrap">
            <TrendingUp className="h-5 w-5 text-blue-500" />
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setGraphMonth(prev => subMonths(prev, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[120px] text-center">{format(graphMonth, "MMMM yyyy")}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setGraphMonth(prev => addMonths(prev, 1))}
                disabled={isFuture(addMonths(startOfMonth(graphMonth), 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <span className="ml-auto">
              <Button variant="outline" size="sm" onClick={handleSyncMonthSpend} disabled={monthSyncLoading} className="text-xs">
                <RefreshCw className={`h-3 w-3 mr-1 ${monthSyncLoading ? "animate-spin" : ""}`} />
                {monthSyncLoading ? "Syncing..." : "Sync Month"}
              </Button>
            </span>
          </CardTitle>
          {monthSyncCalls !== null && !monthSyncLoading && (
            <p className="text-[10px] text-muted-foreground">
              Last sync used <span className="font-semibold text-foreground">{monthSyncCalls}</span> Meta API call{monthSyncCalls === 1 ? "" : "s"}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {!monthlySpendData?.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No spend data this month</p>
          ) : (
            <div className={cn(isMobile ? "h-[220px]" : "h-[280px]")}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlySpendData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-bar-start))" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="hsl(var(--chart-bar-end))" stopOpacity={0.75} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: isMobile ? 9 : 12, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval={isMobile ? 4 : 1}
                    angle={isMobile ? -45 : 0}
                    textAnchor={isMobile ? "end" : "middle"}
                    height={isMobile ? 40 : 30}
                  />
                  <YAxis
                    tick={{ fontSize: isMobile ? 10 : 12, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `$${v}`}
                    width={isMobile ? 45 : 60}
                  />
                  <Tooltip
                    formatter={(value: number) => [`$${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "Spend"]}
                    contentStyle={{
                      borderRadius: "10px",
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--background))",
                      fontSize: isMobile ? "12px" : "14px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    }}
                    labelStyle={{ fontWeight: 600 }}
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                  />
                  <Bar
                    dataKey="spend"
                    fill="url(#barGradient)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={isMobile ? 16 : 28}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:gap-6 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base md:text-lg">Client Spend Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {spenderChart.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No spending data yet</p>
            ) : (
              <div className={cn(isMobile ? "h-[200px]" : "h-[250px] md:h-[300px]")}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={spenderChart} cx="50%" cy="50%" innerRadius={isMobile ? 35 : 60} outerRadius={isMobile ? 70 : 110} paddingAngle={3} dataKey="value" nameKey="name">
                      {spenderChart.map((_, index) => (
                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => [`$${value.toLocaleString()}`, "Spent"]} contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", fontSize: isMobile ? "12px" : "14px" }} />
                    {!isMobile && <Legend />}
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 md:pb-4">
            <CardTitle className="text-base md:text-lg flex items-center gap-2 flex-wrap">
              <Trophy className="h-5 w-5 text-yellow-500" />
              Top Spenders
              <span className="ml-auto flex items-center gap-1">
                <Popover open={topSpenderPickerOpen} onOpenChange={setTopSpenderPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="text-xs gap-1">
                      <CalendarIcon className="h-3 w-3" />
                      {topSpenderPreset
                        ? topSpenderPreset
                        : topSpenderRange?.from && topSpenderRange?.to
                          ? `${format(topSpenderRange.from, "MMM d")} – ${format(topSpenderRange.to, "MMM d")}`
                          : "Pick range"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end" side="bottom">
                    <div className="p-2 space-y-2 max-w-[320px]">
                      <div className="space-y-0.5">
                        <RadioGroup value={topSpenderPreset} onValueChange={(val) => {
                          setTopSpenderPreset(val);
                          const preset = DATE_PRESETS.find(p => p.label === val);
                          if (preset) {
                            const range = preset.getValue();
                            setTopSpenderRange({ from: range.from, to: range.to });
                          }
                        }} className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                          {DATE_PRESETS.map((preset) => (
                            <div key={preset.label} className="flex items-center space-x-1.5">
                              <RadioGroupItem value={preset.label} id={`ts-${preset.label}`} className="h-3 w-3" />
                              <Label htmlFor={`ts-${preset.label}`} className="text-xs cursor-pointer font-normal">{preset.label}</Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                      <Calendar
                        mode="range"
                        selected={topSpenderRange}
                        onSelect={(range) => { setTopSpenderRange(range); setTopSpenderPreset(""); }}
                        numberOfMonths={1}
                        disabled={(d) => d > new Date()}
                        className="pointer-events-auto p-1 text-xs [&_table]:text-xs [&_td]:p-0 [&_th]:p-0 [&_td]:h-7 [&_td]:w-7 [&_th]:w-7 [&_button]:h-7 [&_button]:w-7 [&_button]:text-xs [&_.rdp-caption_label]:text-xs [&_.rdp-nav_button]:h-6 [&_.rdp-nav_button]:w-6"
                      />
                    </div>
                    <div className="flex justify-end border-t px-3 py-2">
                      <Button size="sm" onClick={() => setTopSpenderPickerOpen(false)}>Done</Button>
                    </div>
                  </PopoverContent>
                </Popover>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleUpdateTopSpenders}
                  disabled={topSpenderFetching || !topSpenderFromStr || !topSpenderToStr}
                  className="text-xs gap-1"
                >
                  <RefreshCw className={cn("h-3 w-3", topSpenderFetching && "animate-spin")} />
                  {topSpenderFetching ? "..." : "Update"}
                </Button>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topSpenderFetching ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Fetching live data from Meta...
              </div>
            ) : topThree.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {topSpenderSnapshot ? "No spending data for this range" : "Pick a date range and click Update to fetch."}
              </p>
            ) : (
              <div className="space-y-3 md:space-y-4">
                {topThree.map((spender, i) => {
                  const RankIcon = rankIcons[i];
                  return (
                    <div key={spender.userId} className={cn(
                      "flex items-center gap-3 rounded-lg border transition-colors hover:bg-muted/50 cursor-pointer",
                      isMobile ? "p-2.5" : "md:gap-4 p-3 md:p-4"
                    )} onClick={() => navigate(`/clients/${spender.userId}`)}>
                      <div className={cn(
                        "flex items-center justify-center rounded-full bg-muted flex-shrink-0",
                        isMobile ? "h-8 w-8" : "h-8 w-8 md:h-10 md:w-10"
                      )}>
                        <RankIcon className={cn(
                          isMobile ? "h-4 w-4" : "h-4 w-4 md:h-5 md:w-5",
                          rankColors[i]
                        )} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("font-semibold truncate hover:underline", isMobile ? "text-sm" : "text-sm md:text-base")}>{spender.name}</p>
                        <p className="text-xs text-muted-foreground">#{i + 1}</p>
                      </div>
                      <p className={cn("font-bold", isMobile ? "text-sm" : "text-sm md:text-lg")}>${spender.value.toLocaleString()}</p>
                    </div>
                  );
                })}
                {topSpenderSnapshot && (
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Meta API calls: {topSpenderSnapshot.meta_calls}
                    {topSpenderSnapshot.proxy_ip ? ` • via ${topSpenderSnapshot.proxy_ip}` : ""}
                    {` • updated ${format(new Date(topSpenderSnapshot.fetched_at), "MMM d, HH:mm")}`}
                  </p>
                )}
                {topSpenderSnapshot && !topSpenderRangeMatchesSnapshot && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                    Showing data for {format(new Date(topSpenderSnapshot.from), "MMM d, yyyy")} – {format(new Date(topSpenderSnapshot.to), "MMM d, yyyy")}. Click <b>Update</b> for the new range.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {rateLimitedDetails.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <b>{rateLimitedDetails.length}</b> account(s) failed to fetch from Meta
              {rateLimitedSource ? <span className="text-muted-foreground"> · {rateLimitedSource}</span> : null}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => setRateLimitedDialogOpen(true)}>
            View accounts
          </Button>
        </div>
      )}

      <Dialog open={rateLimitedDialogOpen} onOpenChange={setRateLimitedDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Accounts skipped by Meta ({rateLimitedDetails.length})</DialogTitle>
            <DialogDescription>
              These accounts didn't return spend data. Reasons grouped below — most are Meta rate limits, the rest are token / permission / disabled-account issues.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const map: Record<string, { id: string; account_id?: string; name?: string }> = {};
            (adAccounts ?? []).forEach((a: any) => { map[a.id] = { id: a.id, account_id: a.account_id, name: a.account_name }; });
            const grouped: Record<string, RateLimitedDetail[]> = {};
            rateLimitedDetails.forEach((d) => {
              const key = d.is_rate_limit ? "Rate limited" : (d.reason || "Unknown");
              (grouped[key] = grouped[key] || []).push(d);
            });
            const order = Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length);
            return (
              <div className="space-y-4 mt-2">
                {order.map((reason) => (
                  <div key={reason}>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={reason === "Rate limited" ? "secondary" : "destructive"}>
                        {reason}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{grouped[reason].length} account(s)</span>
                    </div>
                    <div className="rounded border divide-y">
                      {grouped[reason].map((d) => {
                        const acc = map[d.id];
                        return (
                          <div
                            key={d.id}
                            className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-muted/50 cursor-pointer"
                            onClick={() => { setRateLimitedDialogOpen(false); navigate(`/ad-accounts/${d.id}`); }}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate text-primary">{acc?.name || "(unnamed)"}</div>
                              <div className="text-muted-foreground truncate">
                                {acc?.account_id ? `act_${acc.account_id}` : d.id}
                                {d.error_code != null && <> · code {d.error_code}{d.error_subcode ? `/${d.error_subcode}` : ""}</>}
                                {d.http_code != null && <> · http {d.http_code}</>}
                              </div>
                              {d.error_message && reason !== d.error_message && (
                                <div className="text-muted-foreground/80 truncate italic">{d.error_message}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
