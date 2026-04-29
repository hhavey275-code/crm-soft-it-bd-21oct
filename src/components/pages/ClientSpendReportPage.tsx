import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarIcon, ArrowUpDown, BarChart3, Loader2, RefreshCw } from "lucide-react";
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from "date-fns";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { fetchSpendOnly } from "@/lib/fetchSpendOnly";
import type { DateRange } from "react-day-picker";

const DATE_PRESETS = [
  { label: "All Time", getValue: () => null },
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

export default function ClientSpendReportPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  // ----- Persisted snapshot of the LAST manually-fetched Meta result -----
  // Reload / re-login: shows previous snapshot. NO API call until user clicks Update.
  type Snapshot = {
    from: string; // YYYY-MM-DD
    to: string;
    rows: { user_id: string; total_spend: number }[];
    meta_calls: number;
    proxy_ip: string | null;
    fetched_at: string; // ISO
  };
  const STORAGE_KEY = "client-spend-report:snapshot";
  const initialSnapshot: Snapshot | null = (() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as Snapshot;
    } catch {
      return null;
    }
  })();

  const [snapshot, setSnapshot] = useState<Snapshot | null>(initialSnapshot);

  // Date range state: defaults to snapshot range, else Today
  const [dateRange, setDateRange] = useState<DateRange | undefined | null>(() => {
    if (initialSnapshot) {
      return { from: new Date(initialSnapshot.from), to: new Date(initialSnapshot.to) };
    }
    return { from: new Date(), to: new Date() };
  });
  const [selectedPreset, setSelectedPreset] = useState<string>(initialSnapshot ? "" : "Today");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  const fromStr = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : null;
  const toStr = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : null;

  // The selected range may differ from the snapshot range (user picked new dates
  // but hasn't pressed Update yet). We still show snapshot data in that case.
  const rangeMatchesSnapshot =
    !!snapshot && fromStr === snapshot.from && toStr === snapshot.to;

  // Fetch user_ad_accounts assignments (shared by both modes)
  const { data: userAccounts } = useQuery({
    queryKey: ["spend-report-user-accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("user_ad_accounts").select("user_id, ad_account_id");
      return (data as any[]) ?? [];
    },
    staleTime: 2 * 60_000,
  });

  // Manual fetch — only runs when user clicks Update.
  const handleUpdate = async () => {
    if (!fromStr || !toStr || !userAccounts?.length || isFetching) return;
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
        total_spend: accIds.reduce((sum, id) => sum + (accountSpend[id] || 0), 0),
      }));
      const next: Snapshot = {
        from: fromStr,
        to: toStr,
        rows,
        meta_calls: meta_calls ?? 0,
        proxy_ip: proxy_ip ?? null,
        fetched_at: new Date().toISOString(),
      };
      setSnapshot(next);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    } finally {
      setIsFetching(false);
    }
  };

  const { data: profiles } = useQuery({
    queryKey: ["admin-profiles-report"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email");
      return (data as any[]) ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const rawRows = snapshot?.rows ?? [];
  const metaCalls = snapshot?.meta_calls ?? null;
  const proxyIp = snapshot?.proxy_ip ?? null;
  const fetchedAt = snapshot?.fetched_at ?? null;

  const aggregated = useMemo(() => {
    if (!rawRows?.length || !profiles?.length) return [];

    const profileMap: Record<string, any> = {};
    profiles.forEach((p: any) => { profileMap[p.user_id] = p; });

    const list = rawRows
      .filter((r: any) => r.total_spend > 0)
      .map((r: any) => ({
        userId: r.user_id,
        name: profileMap[r.user_id]?.full_name || profileMap[r.user_id]?.email || "Unknown",
        email: profileMap[r.user_id]?.email || "",
        spend: Math.round(r.total_spend * 100) / 100,
      }));

    list.sort((a, b) => sortAsc ? a.spend - b.spend : b.spend - a.spend);
    return list;
  }, [rawRows, profiles, sortAsc]);

  const totalSpend = aggregated.reduce((s, r) => s + r.spend, 0);

  const handlePresetChange = (presetLabel: string) => {
    setSelectedPreset(presetLabel);
    const preset = DATE_PRESETS.find(p => p.label === presetLabel);
    if (preset) {
      const v = preset.getValue();
      setDateRange(v ?? { from: new Date(), to: new Date() });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Client Spend Report
          </h1>
        </div>

        <Card>
          <CardContent className="py-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal gap-2 w-full sm:w-auto", !dateRange && "text-muted-foreground")}>
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
                              <RadioGroupItem value={preset.label} id={`sr-${preset.label}`} className="h-3 w-3" />
                              <Label htmlFor={`sr-${preset.label}`} className="text-xs cursor-pointer font-normal">{preset.label}</Label>
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
                              <RadioGroupItem value={preset.label} id={`sr-${preset.label}`} className="h-3.5 w-3.5" />
                              <Label htmlFor={`sr-${preset.label}`} className="text-sm cursor-pointer font-normal">{preset.label}</Label>
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

              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Total Spend</p>
                  <p className="text-lg font-bold">${totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Clients</p>
                  <p className="text-lg font-bold">{aggregated.length}</p>
                </div>
                {metaCalls !== null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Meta API calls</p>
                    <p className="text-lg font-bold">{metaCalls}</p>
                    {proxyIp && (
                      <p className="text-[10px] text-muted-foreground">via {proxyIp}</p>
                    )}
                    {fetchedAt && (
                      <p className="text-[10px] text-muted-foreground">
                        updated {format(new Date(fetchedAt), "MMM d, HH:mm")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
            {snapshot && !rangeMatchesSnapshot && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                Showing data for {format(new Date(snapshot.from), "MMM d, yyyy")} – {format(new Date(snapshot.to), "MMM d, yyyy")}. Click <b>Update</b> to fetch the new range.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Client Spending</span>
              <Button variant="ghost" size="sm" onClick={() => setSortAsc(!sortAsc)} className="text-xs gap-1">
                <ArrowUpDown className="h-3.5 w-3.5" />
                {sortAsc ? "Low → High" : "High → Low"}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isFetching ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching live data from Meta...
              </div>
            ) : aggregated.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {snapshot ? "No spend data for this period" : "Select a date range and click Update to fetch data"}
              </p>
            ) : isMobile ? (
              <div className="space-y-2">
                {aggregated.map((row, i) => (
                  <div key={row.userId} className="flex items-center gap-3 p-2.5 rounded-lg border">
                    <div className="flex items-center justify-center h-7 w-7 rounded-full bg-muted text-xs font-bold flex-shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-primary cursor-pointer hover:underline" onClick={() => navigate(`/clients/${row.userId}`)}>{row.name}</p>
                    </div>
                    <p className="text-sm font-bold">${row.spend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-right">Total Spend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggregated.map((row, i) => (
                    <TableRow key={row.userId}>
                      <TableCell className="font-medium">{i + 1}</TableCell>
                      <TableCell className="font-medium text-primary cursor-pointer hover:underline" onClick={() => navigate(`/clients/${row.userId}`)}>{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">{row.email}</TableCell>
                      <TableCell className="text-right font-bold">${row.spend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
