import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { MetricCard } from "@/components/MetricCard";
import { Users, Wallet, ArrowUpCircle, MonitorSmartphone, Clock, CalendarIcon, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { format, differenceInDays, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { fetchSpendOnly } from "@/lib/fetchSpendOnly";
import type { DateRange } from "react-day-picker";

const DATE_PRESETS = [
  { label: "Today", getValue: () => ({ from: new Date(), to: new Date() }) },
  { label: "Yesterday", getValue: () => ({ from: subDays(new Date(), 1), to: subDays(new Date(), 1) }) },
  { label: "Last 7 days", getValue: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
  { label: "Last 14 days", getValue: () => ({ from: subDays(new Date(), 13), to: new Date() }) },
  { label: "Last 30 days", getValue: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
  { label: "This week", getValue: () => ({ from: startOfWeek(new Date(), { weekStartsOn: 1 }), to: new Date() }) },
  { label: "Last week", getValue: () => ({ from: startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }), to: endOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }) }) },
  { label: "This month", getValue: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: "Last month", getValue: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
];

type SpendSnapshot = {
  from: string;
  to: string;
  rows: { user_id: string; total: number }[];
  meta_calls: number;
  proxy_ip: string | null;
  fetched_at: string;
};

export function AgencyDashboard() {
  const { user } = useAuth();
  const isMobile = useIsMobile();

  const { data: agency } = useQuery({
    queryKey: ["my-agency", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("agencies").select("*").eq("owner_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  // Persisted snapshot (per agency) — restored on reload, NO auto fetch
  const storageKey = agency?.id ? `agency-top-spenders:${agency.id}` : null;
  const [snapshot, setSnapshot] = useState<SpendSnapshot | null>(null);

  // Load snapshot once agency is known
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setSnapshot(JSON.parse(raw) as SpendSnapshot);
    } catch { /* ignore */ }
  }, [storageKey]);

  // Default range: snapshot range, else This month
  const [dateRange, setDateRange] = useState<DateRange | undefined | null>(() => ({
    from: startOfMonth(new Date()),
    to: new Date(),
  }));
  const [selectedPreset, setSelectedPreset] = useState("This month");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  // When snapshot loads, sync the picker to its range
  useEffect(() => {
    if (snapshot) {
      setDateRange({ from: new Date(snapshot.from), to: new Date(snapshot.to) });
      setSelectedPreset("");
    }
  }, [snapshot?.from, snapshot?.to]);

  const fromStr = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : null;
  const toStr = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : null;
  const rangeMatchesSnapshot =
    !!snapshot && fromStr === snapshot.from && toStr === snapshot.to;

  const { data: agencyWallet } = useQuery({
    queryKey: ["agency-wallet", agency?.id],
    queryFn: async () => {
      const { data } = await supabase.from("agency_wallets").select("*").eq("agency_id", agency!.id).single();
      return data;
    },
    enabled: !!agency?.id,
  });

  const { data: clients } = useQuery({
    queryKey: ["agency-clients", agency?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, status, company")
        .eq("agency_id", agency!.id);
      return data || [];
    },
    enabled: !!agency?.id,
  });

  const { data: recentTopups } = useQuery({
    queryKey: ["agency-recent-topups", agency?.id],
    queryFn: async () => {
      const clientIds = clients?.map(c => c.user_id) || [];
      if (!clientIds.length) return [];
      const { data } = await supabase
        .from("top_up_requests")
        .select("id, amount, status, created_at, user_id")
        .in("user_id", clientIds)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(100);
      return data || [];
    },
    enabled: !!(clients && clients.length > 0),
  });

  // user_ad_accounts assignments for this agency's clients
  const clientIds = useMemo(() => (clients ?? []).map(c => c.user_id), [clients]);
  const { data: userAccounts } = useQuery({
    queryKey: ["agency-user-accounts", agency?.id, clientIds],
    queryFn: async () => {
      if (!clientIds.length) return [];
      const { data } = await supabase
        .from("user_ad_accounts")
        .select("user_id, ad_account_id")
        .in("user_id", clientIds);
      return (data as any[]) ?? [];
    },
    enabled: !!agency?.id && clientIds.length > 0,
    staleTime: 2 * 60_000,
  });

  // Manual fetch (only when user clicks Update)
  const handleUpdate = async () => {
    if (!fromStr || !toStr || !userAccounts?.length || !storageKey || isFetching) return;
    setIsFetching(true);
    try {
      const userAccountMap: Record<string, string[]> = {};
      userAccounts.forEach((ua: any) => {
        if (!userAccountMap[ua.user_id]) userAccountMap[ua.user_id] = [];
        userAccountMap[ua.user_id].push(ua.ad_account_id);
      });
      const allAccountIds = [...new Set(userAccounts.map((ua: any) => ua.ad_account_id))];
      const { spend: accountSpend, meta_calls, proxy_ip } = await fetchSpendOnly(allAccountIds, {
        date_from: fromStr,
        date_to: toStr,
      });
      const rows = Object.entries(userAccountMap).map(([user_id, accIds]) => ({
        user_id,
        total: accIds.reduce((s, id) => s + (accountSpend[id] || 0), 0),
      }));
      const next: SpendSnapshot = {
        from: fromStr,
        to: toStr,
        rows,
        meta_calls: meta_calls ?? 0,
        proxy_ip: proxy_ip ?? null,
        fetched_at: new Date().toISOString(),
      };
      setSnapshot(next);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
    } finally {
      setIsFetching(false);
    }
  };

  const spendRows = snapshot?.rows ?? [];
  const metaCalls = snapshot?.meta_calls ?? null;
  const proxyIp = snapshot?.proxy_ip ?? null;
  const fetchedAt = snapshot?.fetched_at ?? null;

  const topSpenders = useMemo(() => {
    if (!spendRows?.length) return [] as { name: string; total: number }[];
    const list = spendRows
      .filter(r => r.total > 0)
      .map(r => {
        const client = clients?.find(c => c.user_id === r.user_id);
        return {
          name: client?.full_name || client?.email || "Unknown",
          total: Math.round(r.total * 100) / 100,
        };
      });
    list.sort((a, b) => b.total - a.total);
    return list.slice(0, 10);
  }, [spendRows, clients]);
  const top3 = topSpenders.slice(0, 3);

  const handlePresetChange = (presetLabel: string) => {
    setSelectedPreset(presetLabel);
    const preset = DATE_PRESETS.find(p => p.label === presetLabel);
    if (preset) setDateRange(preset.getValue());
  };

  const COLORS = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--primary) / 0.7)",
    "hsl(var(--primary) / 0.55)",
    "hsl(var(--chart-2) / 0.7)",
    "hsl(var(--chart-3) / 0.7)",
    "hsl(var(--primary) / 0.4)",
    "hsl(var(--chart-2) / 0.5)",
    "hsl(var(--chart-3) / 0.5)",
  ];

  const activeClients = clients?.filter(c => c.status === "active").length || 0;
  const pendingClients = clients?.filter(c => c.status === "pending").length || 0;
  const walletBalance = Number(agencyWallet?.balance || 0);
  const isLowBalance = walletBalance <= 0;

  const subscriptionDaysLeft = agency?.subscription_paid_until
    ? Math.max(0, differenceInDays(new Date(agency.subscription_paid_until), new Date()))
    : 0;
  const isExpired = agency?.subscription_paid_until && new Date(agency.subscription_paid_until) < new Date();

  return (
    <div className="space-y-6">
      {isLowBalance && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="p-4 flex items-center gap-3">
            <span className="text-destructive font-semibold text-sm">⚠️ Please top up fast! Due to insufficient limit, your clients are unable to top up.</span>
          </CardContent>
        </Card>
      )}

      <div>
        <h1 className="text-2xl font-bold text-foreground">{agency?.name || "Agency"} Dashboard</h1>
        <p className="text-muted-foreground">Manage your clients and ad accounts</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <MetricCard title="Agency Wallet" value={`$${walletBalance.toLocaleString()}`} icon={Wallet} />
        <MetricCard title="Active Clients" value={String(activeClients)} icon={Users} />
        <MetricCard title="Pending Approvals" value={String(pendingClients)} icon={ArrowUpCircle} />
        <MetricCard title="Total Deposited" value={`$${Number(agencyWallet?.total_deposited || 0).toLocaleString()}`} icon={MonitorSmartphone} />
        <MetricCard title="Subscription" value={`${subscriptionDaysLeft} days`} icon={Clock} />
      </div>

      {/* Subscription Alert */}
      {isExpired && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="p-4">
            <span className="text-destructive font-semibold text-sm">⚠️ Your subscription has expired! Please renew to continue service.</span>
          </CardContent>
        </Card>
      )}

      {/* Top Spenders Chart */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2 space-y-0">
            <CardTitle className="text-base">Top Spenders</CardTitle>
            <div className="flex items-center gap-2">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal gap-2", !dateRange && "text-muted-foreground")}>
                    <CalendarIcon className="h-3.5 w-3.5" />
                    <span className="text-xs">
                      {selectedPreset && selectedPreset !== ""
                        ? selectedPreset
                        : dateRange?.from && dateRange?.to
                          ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d")}`
                          : "Date range"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end" side="bottom">
                  {isMobile ? (
                    <div className="p-2 space-y-2 max-w-[320px]">
                      <div className="space-y-0.5">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Presets</p>
                        <RadioGroup value={selectedPreset} onValueChange={handlePresetChange} className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                          {DATE_PRESETS.map((preset) => (
                            <div key={preset.label} className="flex items-center space-x-1.5">
                              <RadioGroupItem value={preset.label} id={`ag-${preset.label}`} className="h-3 w-3" />
                              <Label htmlFor={`ag-${preset.label}`} className="text-xs cursor-pointer font-normal">{preset.label}</Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                      <Calendar
                        mode="range"
                        selected={dateRange ?? undefined}
                        onSelect={(range) => { setDateRange(range); setSelectedPreset(""); }}
                        numberOfMonths={1}
                        disabled={(d) => d > new Date()}
                        className="pointer-events-auto p-1 text-xs [&_table]:text-xs [&_td]:p-0 [&_th]:p-0 [&_td]:h-7 [&_td]:w-7 [&_th]:w-7 [&_button]:h-7 [&_button]:w-7 [&_button]:text-xs"
                      />
                    </div>
                  ) : (
                    <div className="flex pointer-events-auto">
                      <div className="border-r p-3 space-y-1 min-w-[150px]">
                        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Presets</p>
                        <RadioGroup value={selectedPreset} onValueChange={handlePresetChange}>
                          {DATE_PRESETS.map((preset) => (
                            <div key={preset.label} className="flex items-center space-x-2">
                              <RadioGroupItem value={preset.label} id={`ag-${preset.label}`} className="h-3.5 w-3.5" />
                              <Label htmlFor={`ag-${preset.label}`} className="text-sm cursor-pointer font-normal">{preset.label}</Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                      <div className="p-3">
                        <Calendar
                          mode="range"
                          selected={dateRange ?? undefined}
                          onSelect={(range) => { setDateRange(range); setSelectedPreset(""); }}
                          numberOfMonths={2}
                          disabled={(d) => d > new Date()}
                          className="pointer-events-auto"
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-end border-t px-4 py-2">
                    <Button size="sm" onClick={() => setPickerOpen(false)}>Done</Button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                variant="outline"
                size="sm"
                onClick={handleUpdate}
                disabled={isFetching || !fromStr || !toStr || !userAccounts?.length}
                className="gap-1"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
                <span className="text-xs">Update</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isFetching ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching live data from Meta...
              </div>
            ) : topSpenders.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {snapshot ? "No spending data" : "Pick a date range and click Update to fetch data."}
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={topSpenders} layout="vertical">
                    <XAxis type="number" tickFormatter={v => `$${v}`} />
                    <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v: number) => `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                    <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                      {topSpenders.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {metaCalls !== null && (
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Meta API calls: {metaCalls}{proxyIp ? ` • via ${proxyIp}` : ""}
                    {fetchedAt ? ` • updated ${format(new Date(fetchedAt), "MMM d, HH:mm")}` : ""}
                  </p>
                )}
                {snapshot && !rangeMatchesSnapshot && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                    Showing data for {format(new Date(snapshot.from), "MMM d, yyyy")} – {format(new Date(snapshot.to), "MMM d, yyyy")}. Click <b>Update</b> for the new range.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Top 3 List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 3 Clients</CardTitle>
          </CardHeader>
          <CardContent>
            {isFetching ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : top3.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data</p>
            ) : (
              <div className="space-y-4">
                {top3.map((s, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg">
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-sm">{s.name}</p>
                      <p className="text-xs text-muted-foreground">Total spending</p>
                    </div>
                    <span className="font-bold text-lg">${s.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Top-Ups */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Top-Up Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {!recentTopups?.length ? (
            <p className="text-muted-foreground text-sm">No recent top-up requests</p>
          ) : (
            <div className="space-y-3">
              {recentTopups.slice(0, 10).map(t => {
                const client = clients?.find(c => c.user_id === t.user_id);
                return (
                  <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="font-medium text-sm">{client?.full_name || client?.email || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(t.created_at), "MMM dd, yyyy HH:mm")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">${Number(t.amount).toLocaleString()}</span>
                      <Badge variant="default">{t.status}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
