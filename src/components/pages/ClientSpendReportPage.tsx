import { useState, useMemo } from "react";
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
import { CalendarIcon, ArrowUpDown, BarChart3, Loader2 } from "lucide-react";
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
  const [dateRange, setDateRange] = useState<DateRange | undefined | null>(null);
  const [selectedPreset, setSelectedPreset] = useState("All Time");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);

  const isAllTime = selectedPreset === "All Time" && !dateRange;
  const fromStr = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : null;
  const toStr = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : null;

  // Fetch user_ad_accounts assignments (shared by both modes)
  const { data: userAccounts } = useQuery({
    queryKey: ["spend-report-user-accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("user_ad_accounts").select("user_id, ad_account_id");
      return (data as any[]) ?? [];
    },
    staleTime: 2 * 60_000,
  });

  // All Time query: from ad_accounts.amount_spent
  const { data: allTimeRows, isLoading: allTimeLoading } = useQuery({
    queryKey: ["client-spend-report-alltime"],
    queryFn: async () => {
      if (!userAccounts?.length) return [];
      const accountIds = userAccounts.map(ua => ua.ad_account_id);
      const { data: accounts } = await supabase
        .from("ad_accounts")
        .select("id, amount_spent")
        .in("id", accountIds);

      const accountSpendMap: Record<string, number> = {};
      accounts?.forEach((a: any) => { accountSpendMap[a.id] = Number(a.amount_spent) || 0; });

      const byUser: Record<string, number> = {};
      userAccounts.forEach((ua: any) => {
        if (!byUser[ua.user_id]) byUser[ua.user_id] = 0;
        byUser[ua.user_id] += accountSpendMap[ua.ad_account_id] || 0;
      });

      return Object.entries(byUser).map(([userId, spend]) => ({
        user_id: userId,
        total_spend: spend,
      }));
    },
    enabled: isAllTime && !!userAccounts?.length,
  });

  // Date range query: LIVE from Meta API via chunkedMetaSync
  const { data: metaRows, isLoading: metaLoading } = useQuery({
    queryKey: ["client-spend-report-meta", fromStr, toStr],
    queryFn: async () => {
      if (!fromStr || !toStr || !userAccounts?.length) return [];

      // Build user -> accountIds map
      const userAccountMap: Record<string, string[]> = {};
      userAccounts.forEach((ua: any) => {
        if (!userAccountMap[ua.user_id]) userAccountMap[ua.user_id] = [];
        userAccountMap[ua.user_id].push(ua.ad_account_id);
      });

      // Get all unique ad account IDs
      const allAccountIds = [...new Set(userAccounts.map((ua: any) => ua.ad_account_id))];

      // Lightweight spend-only batch fetch (Meta Batch API: ~50 accounts per HTTP call)
      const { spend: accountSpend } = await fetchSpendOnly(allAccountIds, {
        date_from: fromStr,
        date_to: toStr,
      });

      // Aggregate per user
      return Object.entries(userAccountMap).map(([userId, accIds]) => ({
        user_id: userId,
        total_spend: accIds.reduce((sum, id) => sum + (accountSpend[id] || 0), 0),
      }));
    },
    enabled: !isAllTime && !!fromStr && !!toStr && !!userAccounts?.length,
    staleTime: 0,
  });

  const { data: profiles } = useQuery({
    queryKey: ["admin-profiles-report"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email");
      return (data as any[]) ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const isLoading = isAllTime ? allTimeLoading : metaLoading;
  const rawRows = isAllTime ? allTimeRows : metaRows;

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
    if (presetLabel === "All Time") {
      setDateRange(null);
    } else {
      const preset = DATE_PRESETS.find(p => p.label === presetLabel);
      if (preset) setDateRange(preset.getValue());
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
                  <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal gap-2 w-full sm:w-auto", !dateRange && !isAllTime && "text-muted-foreground")}>
                    <CalendarIcon className="h-4 w-4" />
                    {isAllTime
                      ? "All Time"
                      : dateRange?.from && dateRange?.to
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

              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Total Spend</p>
                  <p className="text-lg font-bold">${totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Clients</p>
                  <p className="text-lg font-bold">{aggregated.length}</p>
                </div>
              </div>
            </div>
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
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {!isAllTime ? "Fetching live data from Meta..." : "Loading..."}
              </div>
            ) : aggregated.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No spend data for this period</p>
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
