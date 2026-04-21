import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { CardBrandIcon } from "@/components/CardBrandIcon";
import { ArrowUp, ArrowDown, AppWindow, RefreshCw, Search, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface InsightsData {
  balance: number;
  cards: { id: string; display_string: string; type: number }[];
  updated_at?: string;
}

const PAGE_SIZE = 20;
const SYNC_CHUNK_SIZE = 50;

export default function BillingsPage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [cardFilter, setCardFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [syncProgress, setSyncProgress] = useState("");
  const queryClient = useQueryClient();

  const { data: accounts } = useQuery({
    queryKey: ["billings-accounts", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("ad_accounts").select("*");
      return (data as any[]) ?? [];
    },
    enabled: !!user,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: insights = {} } = useQuery({
    queryKey: ["billings-insights", user?.id],
    queryFn: async () => {
      if (!accounts || accounts.length === 0) return {};
      const ids = accounts.map((a: any) => a.id);
      const { data } = await supabase.functions.invoke("get-account-insights", {
        body: { ad_account_ids: ids, source: "cache" },
      });
      return (data?.insights as Record<string, InsightsData>) ?? {};
    },
    enabled: !!user && !!accounts && accounts.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!accounts || accounts.length === 0) return;
      const ids = accounts.map((a: any) => a.id);
      const totalCount = ids.length;
      let synced = 0;

      for (let i = 0; i < ids.length; i += SYNC_CHUNK_SIZE) {
        const chunk = ids.slice(i, i + SYNC_CHUNK_SIZE);
        setSyncProgress(`Syncing ${Math.min(i + SYNC_CHUNK_SIZE, totalCount)}/${totalCount}...`);
        const { data, error } = await supabase.functions.invoke("get-account-insights", {
          body: { ad_account_ids: chunk, source: "meta" },
        });
        if (error) throw error;
        synced += chunk.length;
        // Refresh cache after each batch so UI updates incrementally
        queryClient.invalidateQueries({ queryKey: ["billings-insights"] });
        queryClient.invalidateQueries({ queryKey: ["billings-accounts"] });
      }
      return { synced };
    },
    onSuccess: () => {
      setSyncProgress("");
      queryClient.invalidateQueries({ queryKey: ["billings-insights"] });
      queryClient.invalidateQueries({ queryKey: ["billings-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
      toast.success("Data updated from Meta");
    },
    onError: (err: any) => {
      setSyncProgress("");
      toast.error(err?.message || "Failed to update from Meta");
    },
  });

  const lastUpdatedDate = useMemo(() => {
    const times = Object.values(insights as Record<string, InsightsData>)
      .map((i) => i.updated_at)
      .filter(Boolean);
    if (times.length === 0) return null;
    return new Date(times.sort().reverse()[0]!);
  }, [insights]);

  const [timeAgoStr, setTimeAgoStr] = useState("");
  useEffect(() => {
    if (!lastUpdatedDate) { setTimeAgoStr(""); return; }
    const update = () => {
      const diffMs = Date.now() - lastUpdatedDate.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) setTimeAgoStr("just now");
      else if (diffSec < 3600) setTimeAgoStr(`${Math.floor(diffSec / 60)} min ago`);
      else if (diffSec < 86400) setTimeAgoStr(`${Math.floor(diffSec / 3600)} hr ago`);
      else setTimeAgoStr(`${Math.floor(diffSec / 86400)} day(s) ago`);
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [lastUpdatedDate]);

  const uniqueCards = useMemo(() => {
    if (!insights) return [];
    const cards = new Set<string>();
    Object.values(insights as Record<string, InsightsData>).forEach((ins) => {
      ins.cards?.forEach((c) => cards.add(c.display_string));
    });
    return Array.from(cards);
  }, [insights]);

  const sorted = useMemo(() => {
    if (!accounts) return [];
    const q = search.toLowerCase();
    return [...accounts]
      .filter((a: any) => {
        if (q && !a.account_name?.toLowerCase().includes(q) && !a.account_id?.toLowerCase().includes(q)) return false;
        if (statusFilter !== "all" && a.status?.toLowerCase() !== statusFilter) return false;
        if (cardFilter !== "all") {
          const ins = (insights as any)[a.id] as InsightsData | undefined;
          const hasCard = ins?.cards?.some((c) => c.display_string === cardFilter);
          if (!hasCard) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const balA = Number((insights as any)[a.id]?.balance ?? 0);
        const balB = Number((insights as any)[b.id]?.balance ?? 0);
        return sortDir === "asc" ? balA - balB : balB - balA;
      });
  }, [accounts, insights, sortDir, search, statusFilter, cardFilter]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const resetPage = () => setCurrentPage(1);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className={cn("flex gap-2", isMobile ? "flex-col" : "items-center justify-between")}>
          <div>
            <h1 className="text-xl md:text-2xl font-bold">Billings</h1>
            {timeAgoStr && (
              <p className="text-xs text-muted-foreground mt-0.5">Synced {timeAgoStr}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !accounts?.length}
            className="self-start"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncProgress || (isMobile ? "Update" : "Update from Meta")}
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[140px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or ID..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); resetPage(); }}
              className={cn("pl-9 h-9", isMobile && "rounded-full")}
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); resetPage(); }}>
            <SelectTrigger className="w-[110px] md:w-[140px] h-9 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="unsettled">Unsettled</SelectItem>
            </SelectContent>
          </Select>
          {!isMobile && (
            <Select value={cardFilter} onValueChange={(v) => { setCardFilter(v); resetPage(); }}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder="Card" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Cards</SelectItem>
                {uniqueCards.map((card) => (
                  <SelectItem key={card} value={card}>{card}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Mobile Card Layout */}
        {isMobile ? (
          <div className="space-y-3">
            {paginated.map((acc: any) => {
              const ins = (insights as any)[acc.id] as InsightsData | undefined;
              const balance = Number(ins?.balance ?? 0);
              const remaining = Math.max(0, Number(acc.spend_cap) - Number(acc.amount_spent));
              const ratio = Number(acc.spend_cap) > 0 ? Number(acc.amount_spent) / Number(acc.spend_cap) : 0;
              const percentage = Math.min(ratio * 100, 100);
              const barColor = ratio >= 0.8 ? "bg-destructive" : ratio >= 0.5 ? "bg-yellow-500" : "bg-primary";

              return (
                <Card key={acc.id} className="border border-border/60 shadow-sm">
                  <CardContent className="p-4">
                    {/* Header: Name + Status */}
                    <div className="flex items-start justify-between mb-1">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm text-foreground truncate">{acc.account_name}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[11px] text-muted-foreground font-mono">{acc.account_id.replace(/^act_/, '')}</span>
                          <a
                            href={`https://business.facebook.com/billing_hub/accounts/details?asset_id=${acc.account_id.replace(/^act_/, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                      <StatusBadge status={acc.status} />
                    </div>

                    {/* Remaining + Progress */}
                    <div className="mt-3">
                      <p className="text-sm font-medium text-foreground">
                        Remaining: <span className="font-bold">${remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </p>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden mt-1.5">
                        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${percentage}%` }} />
                      </div>
                    </div>

                    {/* Spent / Limit */}
                    <div className="flex items-center justify-between mt-2.5">
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>Spent: <span className="font-medium text-foreground">${Number(acc.amount_spent).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                        <span>Limit: <span className="font-medium text-foreground">${Number(acc.spend_cap).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                      </div>
                    </div>

                    {/* Balance + Card */}
                    <div className="mt-2.5 flex items-center justify-between">
                      <div className="text-xs">
                        <span className="text-muted-foreground">Balance: </span>
                        <span className="font-semibold text-foreground">${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      {ins?.cards?.[0] && (
                        <div className="flex items-center gap-1">
                          <CardBrandIcon displayString={ins.cards[0].display_string} size="xs" />
                          <span className="text-xs text-muted-foreground">{ins.cards[0].display_string}</span>
                        </div>
                      )}
                    </div>

                    {/* Billing button */}
                    <div className="mt-2.5">
                      <a
                        href={`https://business.facebook.com/billing_hub/accounts/details?asset_id=${acc.account_id.replace(/^act_/, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button
                          size="sm"
                          className="w-full h-8 text-xs rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-md shadow-blue-500/25 transition-all hover:shadow-lg hover:shadow-blue-500/30 font-semibold"
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Billing
                        </Button>
                      </a>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {sorted.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">No ad accounts found</p>
            )}

            {/* Mobile Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-1">
                <p className="text-xs text-muted-foreground">
                  {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, sorted.length)} of {sorted.length}
                </p>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={safePage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs text-muted-foreground px-2">{safePage}/{totalPages}</span>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={safePage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Desktop Table */
          <Card>
            <CardContent className="pt-4 px-3">
              {sorted.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No ad accounts found</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40%]">Account</TableHead>
                        <TableHead className="text-right w-[110px]">
                          <button
                            className="flex items-center text-xs font-medium ml-auto"
                            onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
                          >
                            Balance
                            {sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />}
                          </button>
                        </TableHead>
                        
                        <TableHead>Status</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead className="w-[80px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginated.map((acc: any) => {
                        const ins = (insights as any)[acc.id] as InsightsData | undefined;
                        const balance = Number(ins?.balance ?? 0);
                        return (
                          <TableRow key={acc.id}>
                            <TableCell className="py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                                  <AppWindow className="h-3 w-3 text-muted-foreground" />
                                </div>
                                <div>
                                  <div className="text-sm leading-tight">{acc.account_name}</div>
                                  <div className="text-[11px] text-muted-foreground font-mono">ID: {acc.account_id.replace(/^act_/, '')}</div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="py-2.5 text-right font-semibold text-sm">
                              ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="py-2.5">
                              <StatusBadge status={acc.status} />
                            </TableCell>
                            <TableCell className="py-2.5">
                              {ins?.cards && ins.cards.length > 0 ? (
                                ins.cards.map((card: any, i: number) => (
                                  <div key={i} className="flex items-center gap-1">
                                    <CardBrandIcon displayString={card.display_string} size="xs" />
                                    <span className="text-xs">{card.display_string}</span>
                                  </div>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="py-2.5" onClick={(e) => e.stopPropagation()}>
                              <a
                                href={`https://business.facebook.com/billing_hub/accounts/details?asset_id=${acc.account_id.replace(/^act_/, '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Button
                                  size="sm"
                                  className="h-7 px-3 text-xs rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-md shadow-blue-500/25 transition-all hover:shadow-lg hover:shadow-blue-500/30"
                                >
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  Billing
                                </Button>
                              </a>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-4 px-2">
                      <p className="text-xs text-muted-foreground">
                        Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, sorted.length)} of {sorted.length}
                      </p>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={safePage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </Button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                          <Button
                            key={p}
                            variant={p === safePage ? "default" : "outline"}
                            size="sm"
                            className="h-7 w-7 p-0 text-xs"
                            onClick={() => setCurrentPage(p)}
                          >
                            {p}
                          </Button>
                        ))}
                        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={safePage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}