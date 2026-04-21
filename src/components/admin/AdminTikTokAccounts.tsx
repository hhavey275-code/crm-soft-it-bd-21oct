import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";
import { SpendProgressBar } from "@/components/SpendProgressBar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { ArrowUpCircle, ArrowUp, ArrowDown, ArrowUpDown, RefreshCw, AppWindow, Search, ListChecks, Trash2, ChevronLeft, ChevronRight, MoreHorizontal, Check, ChevronsUpDown, Loader2, ExternalLink, AlertTriangle, Settings } from "lucide-react";
import { friendlyEdgeError } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

export function AdminTikTokAccounts() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [search, setSearch] = useState(() => sessionStorage.getItem("tiktokAccountsSearch") || "");
  useEffect(() => { sessionStorage.setItem("tiktokAccountsSearch", search); }, [search]);
  const [statusFilter, setStatusFilter] = useState(() => sessionStorage.getItem("tiktokAccountsStatusFilter") || "all");
  const [sortField, setSortField] = useState<string>(() => sessionStorage.getItem("tiktokAccountsSortField") || "account_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => (sessionStorage.getItem("tiktokAccountsSortDir") as "asc" | "desc") || "asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSelect, setShowSelect] = useState(false);
  const [currentPage, setCurrentPage] = useState(() => Number(sessionStorage.getItem("tiktokAccountsPage")) || 1);
  useEffect(() => { sessionStorage.setItem("tiktokAccountsStatusFilter", statusFilter); }, [statusFilter]);
  useEffect(() => { sessionStorage.setItem("tiktokAccountsSortField", sortField); }, [sortField]);
  useEffect(() => { sessionStorage.setItem("tiktokAccountsSortDir", sortDir); }, [sortDir]);
  useEffect(() => { sessionStorage.setItem("tiktokAccountsPage", String(currentPage)); }, [currentPage]);

  // Top up
  const [topUpAccount, setTopUpAccount] = useState<any>(null);
  const [topUpAmount, setTopUpAmount] = useState("");

  // Update Spend Cap
  const [updateCapAccount, setUpdateCapAccount] = useState<any>(null);
  const [newSpendCap, setNewSpendCap] = useState("");

  // Bulk actions
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignClientId, setAssignClientId] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [showUnassignConfirm, setShowUnassignConfirm] = useState(false);

  // Fetch TikTok ad accounts
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["tiktok-ad-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_accounts")
        .select("*, business_managers(name, bm_id)")
        .eq("platform", "tiktok")
        .order("account_name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch insights for TikTok accounts
  const { data: insightsMap = {} } = useQuery({
    queryKey: ["tiktok-insights-cache"],
    queryFn: async () => {
      if (!accounts || accounts.length === 0) return {};
      const ids = accounts.map((a: any) => a.id);
      const { data } = await supabase
        .from("ad_account_insights")
        .select("*")
        .in("ad_account_id", ids);
      const map: Record<string, any> = {};
      (data ?? []).forEach((row: any) => { map[row.ad_account_id] = row; });
      return map;
    },
    enabled: accounts.length > 0,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Fetch TikTok BCs for sync
  const { data: bcs = [] } = useQuery({
    queryKey: ["tiktok-bcs-for-sync"],
    queryFn: async () => {
      const { data } = await supabase
        .from("business_managers")
        .select("id, name")
        .eq("platform", "tiktok")
        .eq("status", "active");
      return data ?? [];
    },
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ["admin-user-ad-accounts"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("user_ad_accounts").select("*");
      return (data as any[]) ?? [];
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["admin-clients-list"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email");
      return (data as any[]) ?? [];
    },
  });

  const { data: allWallets = [] } = useQuery({
    queryKey: ["admin-all-wallets"],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("user_id, balance");
      return (data as any[]) ?? [];
    },
  });

  // Sync all BCs (Update from BC)
  const [syncing, setSyncing] = useState(false);
  const syncAllMutation = useMutation({
    mutationFn: async () => {
      setSyncing(true);
      let totalSynced = 0;
      for (const bc of bcs) {
        const { data, error } = await supabase.functions.invoke("tiktok-sync", {
          body: { business_manager_id: bc.id },
        });
        if (error) console.warn("Sync error for", bc.name, error);
        else totalSynced += data?.synced_count ?? 0;
      }
      return totalSynced;
    },
    onSuccess: (count) => {
      toast.success(`Updated ${count} accounts from TikTok BC`);
      queryClient.invalidateQueries({ queryKey: ["tiktok-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["tiktok-insights-cache"] });
      setSyncing(false);
    },
    onError: (err: any) => {
      toast.error(friendlyEdgeError(err));
      setSyncing(false);
    },
  });

  // Top up mutation
  const topUpMutation = useMutation({
    mutationFn: async () => {
      if (!topUpAccount || !topUpAmount) throw new Error("Missing data");
      const amt = parseFloat(topUpAmount);
      if (isNaN(amt) || amt <= 0) throw new Error("Invalid amount");
      const assignedUserId = getAssignedUserId(topUpAccount.id);
      const { data, error } = await supabase.functions.invoke("tiktok-topup", {
        body: { ad_account_id: topUpAccount.id, amount: amt, deduct_wallet: !!assignedUserId, target_user_id: assignedUserId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      const acc = topUpAccount;
      const amt = topUpAmount;
      const bmId = acc?.business_managers?.bm_id;
      const billingUrl = bmId
        ? `https://business.tiktok.com/manage/payment/v2?org_id=${bmId}&aadvid=${acc?.account_id}`
        : `https://ads.tiktok.com/i18n/account/payment?aadvid=${acc?.account_id}`;
      
      // Auto-open TikTok billing page for the specific account
      window.open(billingUrl, "_blank");
      
      toast.success(`CRM spend cap updated: +$${amt}. TikTok Budget Manager opened.`, { duration: 5000 });
      setTopUpAccount(null);
      setTopUpAmount("");
      queryClient.invalidateQueries({ queryKey: ["tiktok-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-wallets"] });
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
  });

  // Update spend cap mutation (admin sets exact value)
  const updateCapMutation = useMutation({
    mutationFn: async () => {
      if (!updateCapAccount || !newSpendCap) throw new Error("Missing data");
      const cap = parseFloat(newSpendCap);
      if (isNaN(cap) || cap < 0) throw new Error("Invalid spend cap");
      const { error } = await supabase.from("ad_accounts").update({ spend_cap: cap, fraud_flag: false } as any).eq("id", updateCapAccount.id);
      if (error) throw error;
      return cap;
    },
    onSuccess: (cap) => {
      const acc = updateCapAccount;
      const bmId = acc?.business_managers?.bm_id;
      const billingUrl = bmId
        ? `https://business.tiktok.com/manage/payment/v2?org_id=${bmId}&aadvid=${acc?.account_id}`
        : `https://ads.tiktok.com/i18n/account/payment?aadvid=${acc?.account_id}`;
      window.open(billingUrl, "_blank");
      toast.success(`Spend cap updated to $${cap.toLocaleString()}. TikTok billing page opened.`);
      setUpdateCapAccount(null);
      setNewSpendCap("");
      queryClient.invalidateQueries({ queryKey: ["tiktok-ad-accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Bulk delete
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedIds);
      await (supabase as any).from("user_ad_accounts").delete().in("ad_account_id", ids);
      await supabase.from("ad_account_insights").delete().in("ad_account_id", ids);
      const { error } = await supabase.from("ad_accounts").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`${selectedIds.size} account(s) deleted`);
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["tiktok-ad-accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Bulk assign
  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!assignClientId) throw new Error("Select a client");
      for (const id of selectedIds) {
        await (supabase as any).from("user_ad_accounts").delete().eq("ad_account_id", id);
        await (supabase as any).from("user_ad_accounts").insert({ user_id: assignClientId, ad_account_id: id });
      }
    },
    onSuccess: () => {
      toast.success(`${selectedIds.size} account(s) assigned`);
      setSelectedIds(new Set());
      setShowAssignDialog(false);
      queryClient.invalidateQueries({ queryKey: ["admin-user-ad-accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Bulk unassign
  const unassignMutation = useMutation({
    mutationFn: async () => {
      for (const id of selectedIds) {
        await (supabase as any).from("user_ad_accounts").delete().eq("ad_account_id", id);
      }
    },
    onSuccess: () => {
      toast.success(`${selectedIds.size} account(s) unassigned`);
      setSelectedIds(new Set());
      setShowUnassignConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["admin-user-ad-accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const getAssignedUserId = (accountId: string) => assignments.find((a: any) => a.ad_account_id === accountId)?.user_id ?? null;
  const getClientName = (userId: string | null) => {
    if (!userId) return "Unassigned";
    const c = clients.find((c: any) => c.user_id === userId);
    return c?.full_name || c?.email || userId;
  };
  const getClientWallet = (userId: string | null) => {
    if (!userId) return null;
    return allWallets.find((w: any) => w.user_id === userId);
  };

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const sortedAccounts = useMemo(() => {
    const q = search.toLowerCase();
    return [...accounts]
      .filter((a: any) => {
        if (q && !a.account_name?.toLowerCase().includes(q) && !a.account_id?.toLowerCase().includes(q)) return false;
        if (statusFilter !== "all" && a.status?.toLowerCase() !== statusFilter) return false;
        return true;
      })
      .sort((a: any, b: any) => {
        let valA: any, valB: any;
        const insA = insightsMap[a.id];
        const insB = insightsMap[b.id];
        switch (sortField) {
          case "account_name": valA = a.account_name?.toLowerCase(); valB = b.account_name?.toLowerCase(); break;
          case "today_spend": valA = insA?.today_spend ?? 0; valB = insB?.today_spend ?? 0; break;
          case "yesterday_spend": valA = insA?.yesterday_spend ?? 0; valB = insB?.yesterday_spend ?? 0; break;
          case "balance": valA = insA?.balance ?? 0; valB = insB?.balance ?? 0; break;
          case "spend_cap": valA = Number(a.spend_cap); valB = Number(b.spend_cap); break;
          default: valA = a.account_name?.toLowerCase(); valB = b.account_name?.toLowerCase();
        }
        if (valA < valB) return sortDir === "asc" ? -1 : 1;
        if (valA > valB) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
  }, [accounts, insightsMap, sortField, sortDir, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(sortedAccounts.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedAccounts = sortedAccounts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useMemo(() => { setCurrentPage(1); }, [search, statusFilter]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const pageIds = paginatedAccounts.map((a: any) => a.id);
    const allSelected = pageIds.every((id: string) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(prev => { const next = new Set(prev); pageIds.forEach((id: string) => next.delete(id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); pageIds.forEach((id: string) => next.add(id)); return next; });
    }
  };

  const allPageSelected = paginatedAccounts.length > 0 && paginatedAccounts.every((a: any) => selectedIds.has(a.id));

  const assignedUserId = topUpAccount ? getAssignedUserId(topUpAccount.id) : null;
  const assignedWallet = getClientWallet(assignedUserId);
  const assignedClientName = getClientName(assignedUserId);
  const clientBalance = Number(assignedWallet?.balance ?? 0);
  const parsedAmount = parseFloat(topUpAmount) || 0;
  const willGoNegative = parsedAmount > clientBalance;

  const filteredClients = useMemo(() => {
    if (!clientSearch) return clients;
    const s = clientSearch.toLowerCase();
    return clients.filter((c: any) => (c.full_name?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s)));
  }, [clients, clientSearch]);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className={cn("flex gap-2", isMobile ? "flex-col" : "items-center justify-between")}>
        <h1 className="text-xl md:text-2xl font-bold">TikTok Ad Accounts</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {showSelect && selectedIds.size > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  <MoreHorizontal className="h-4 w-4 mr-1" />
                  Actions ({selectedIds.size})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setShowAssignDialog(true); setAssignClientId(""); }}>
                  Assign Selected
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowUnassignConfirm(true)}>
                  Unassign Selected
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setShowDeleteConfirm(true)}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Selected
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="outline" size="sm" onClick={() => syncAllMutation.mutate()} disabled={syncing || bcs.length === 0} className="text-xs">
            <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? "Updating..." : isMobile ? "Update All" : "Update All from BC"}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className={cn("pl-9 h-9", isMobile && "rounded-full")} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[110px] md:w-[140px] h-9 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        {isMobile && (
          <Select value={`${sortField}:${sortDir}`} onValueChange={(v) => { const [f, d] = v.split(":"); setSortField(f); setSortDir(d as "asc" | "desc"); }}>
            <SelectTrigger className="w-[120px] h-9 text-xs">
              <ArrowUpDown className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="account_name:asc">Name A-Z</SelectItem>
              <SelectItem value="account_name:desc">Name Z-A</SelectItem>
              <SelectItem value="spend_cap:desc">Budget High</SelectItem>
              <SelectItem value="spend_cap:asc">Budget Low</SelectItem>
              <SelectItem value="balance:desc">Balance High</SelectItem>
              <SelectItem value="balance:asc">Balance Low</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Button variant={showSelect ? "secondary" : "ghost"} size="icon" className="h-9 w-9" onClick={() => { setShowSelect((v) => !v); if (showSelect) setSelectedIds(new Set()); }} title="Toggle selection">
          <ListChecks className="h-4 w-4" />
        </Button>
      </div>

      {/* Mobile Cards */}
      {isMobile ? (
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : paginatedAccounts.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">No TikTok ad accounts found</p>
          ) : paginatedAccounts.map((a: any) => {
            const ins = insightsMap[a.id];
            const uid = getAssignedUserId(a.id);
            const clientName = getClientName(uid);
            const remaining = Math.max(0, Number(a.spend_cap) - Number(a.amount_spent));
            const ratio = Number(a.spend_cap) > 0 ? Number(a.amount_spent) / Number(a.spend_cap) : 0;
            const percentage = Math.min(ratio * 100, 100);
            const barColor = ratio >= 0.8 ? "bg-destructive" : ratio >= 0.5 ? "bg-yellow-500" : "bg-primary";

            return (
              <Card key={a.id} className="border border-border/60 shadow-sm cursor-pointer active:scale-[0.98] transition-transform" onClick={() => navigate(`/ad-accounts/${a.id}`)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-1">
                    {showSelect && (
                      <div className="pt-0.5 mr-2" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(a.id)} onCheckedChange={() => toggleSelect(a.id)} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-sm text-foreground truncate">{a.account_name}</p>
                        {a.fraud_flag && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-muted-foreground font-mono">{a.account_id}</span>
                        {a.account_id && (
                          <a
                            href={`https://ads.tiktok.com/i18n/account/payment?aadvid=${a.account_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>

                  <div className="mt-3">
                    <p className="text-sm font-medium text-foreground">
                      Remaining: <span className="font-bold">${remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </p>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden mt-1.5">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${percentage}%` }} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-2.5">
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Spent: <span className="font-medium text-foreground">${Number(a.amount_spent).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                      <span>Limit: <span className="font-medium text-foreground">${Number(a.spend_cap).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                    </div>
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      className="gap-1 bg-blue-600 hover:bg-blue-700 text-white shadow-md rounded-full px-4 font-semibold text-xs h-8"
                      onClick={() => { setTopUpAccount(a); setTopUpAmount(""); }}
                    >
                      <ArrowUpCircle className="h-3.5 w-3.5" />
                      Top Up
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 rounded-full px-3 font-semibold text-xs h-8"
                      onClick={() => { setUpdateCapAccount(a); setNewSpendCap(String(a.spend_cap ?? 0)); }}
                    >
                      <Settings className="h-3.5 w-3.5" />
                      Set Cap
                    </Button>
                    </div>
                  </div>

                  {ins && (
                    <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
                      <div className="bg-muted/50 rounded-md p-1.5">
                        <p className="text-[10px] text-muted-foreground">Today Spend</p>
                        <p className="text-xs font-semibold">${Number(ins.today_spend ?? 0).toLocaleString()}</p>
                      </div>
                      <div className="bg-muted/50 rounded-md p-1.5">
                        <p className="text-[10px] text-muted-foreground">Yesterday</p>
                        <p className="text-xs font-semibold">${Number(ins.yesterday_spend ?? 0).toLocaleString()}</p>
                      </div>
                      <div className="bg-muted/50 rounded-md p-1.5">
                        <p className="text-[10px] text-muted-foreground">Balance</p>
                        <p className="text-xs font-semibold">${Number(ins.balance ?? 0).toLocaleString()}</p>
                      </div>
                    </div>
                  )}

                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {uid ? (
                        <span className="text-primary cursor-pointer hover:underline" onClick={() => navigate(`/clients/${uid}`)}>{clientName}</span>
                      ) : "Unassigned"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        /* Desktop Table */
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  {showSelect && (
                    <TableHead className="w-[40px]">
                      <Checkbox checked={allPageSelected} onCheckedChange={toggleSelectAll} aria-label="Select all" />
                    </TableHead>
                  )}
                  <TableHead className="w-[200px]">
                    <button className="flex items-center text-xs font-medium" onClick={() => toggleSort("account_name")}>
                      Ad Account <SortIcon field="account_name" />
                    </button>
                  </TableHead>
                  <TableHead className="w-[100px]">
                    <button className="flex items-center text-xs font-medium" onClick={() => toggleSort("spend_cap")}>
                      Budget <SortIcon field="spend_cap" />
                    </button>
                  </TableHead>
                  <TableHead className="w-[90px]"><span className="text-xs font-medium">Status</span></TableHead>
                  <TableHead className="w-[90px]">
                    <button className="flex items-center text-xs font-medium" onClick={() => toggleSort("balance")}>
                      Balance <SortIcon field="balance" />
                    </button>
                  </TableHead>
                  <TableHead className="w-[100px]">
                    <button className="flex items-center text-xs font-medium" onClick={() => toggleSort("today_spend")}>
                      Today <SortIcon field="today_spend" />
                    </button>
                  </TableHead>
                  <TableHead className="w-[100px]">
                    <button className="flex items-center text-xs font-medium" onClick={() => toggleSort("yesterday_spend")}>
                      Yesterday <SortIcon field="yesterday_spend" />
                    </button>
                  </TableHead>
                  <TableHead className="w-[90px]"><span className="text-xs font-medium">Client</span></TableHead>
                  <TableHead className="w-[50px]"><span className="text-xs font-medium">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
                ) : paginatedAccounts.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No TikTok ad accounts found</TableCell></TableRow>
                ) : paginatedAccounts.map((a: any) => {
                  const ins = insightsMap[a.id];
                  return (
                    <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/ad-accounts/${a.id}`)} data-state={selectedIds.has(a.id) ? "selected" : undefined}>
                      {showSelect && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selectedIds.has(a.id)} onCheckedChange={() => toggleSelect(a.id)} />
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                            <AppWindow className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-primary">{a.account_name}</span>
                              {a.fraud_flag && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                            </div>
                            {a.business_managers?.name && <div className="text-xs text-muted-foreground">{a.business_managers.name}</div>}
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground font-mono">{a.account_id}</span>
                              {a.account_id && (
                                <a
                                  href={`https://ads.tiktok.com/i18n/account/payment?aadvid=${a.account_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-muted-foreground hover:text-primary"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <SpendProgressBar amountSpent={Number(a.amount_spent)} spendCap={Number(a.spend_cap)} balanceAfterTopup={Number(a.balance_after_topup ?? 0)} platform="tiktok" />
                      </TableCell>
                      <TableCell><StatusBadge status={a.status} /></TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="text-sm">${ins?.balance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="text-sm">${ins?.today_spend?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="text-sm">${ins?.yesterday_spend?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</span>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const uid = getAssignedUserId(a.id);
                          const name = getClientName(uid);
                          return uid ? (
                            <span className="text-sm cursor-pointer hover:underline" onClick={() => navigate(`/clients/${uid}`)}>{name}</span>
                          ) : <span className="text-sm text-muted-foreground">{name}</span>;
                        })()}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button size="sm" className="h-8 bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => { setTopUpAccount(a); setTopUpAmount(""); }}>
                            <ArrowUpCircle className="h-3.5 w-3.5 mr-1" />
                            Top Up
                          </Button>
                          <Button size="sm" variant="outline" className="h-8" onClick={() => { setUpdateCapAccount(a); setNewSpendCap(String(a.spend_cap ?? 0)); }}>
                            <Settings className="h-3.5 w-3.5 mr-1" />
                            Set Cap
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t pt-4 mt-4">
                <span className="text-sm text-muted-foreground">
                  Showing {((safePage - 1) * PAGE_SIZE) + 1}–{Math.min(safePage * PAGE_SIZE, sortedAccounts.length)} of {sortedAccounts.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" className="h-8 w-8" disabled={safePage <= 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                    .map((p, idx, arr) => (
                      <span key={p} className="flex items-center">
                        {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-muted-foreground">…</span>}
                        <Button variant={p === safePage ? "default" : "outline"} size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p)}>{p}</Button>
                      </span>
                    ))}
                  <Button variant="outline" size="icon" className="h-8 w-8" disabled={safePage >= totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Top Up Dialog */}
      <Dialog open={!!topUpAccount} onOpenChange={(o) => !o && setTopUpAccount(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Top Up TikTok Account</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{topUpAccount?.account_name} ({topUpAccount?.account_id})</p>
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-300">
            ⚠️ CRM এ spend cap update হবে। Top up এর পর TikTok Budget Manager এ manually confirm করতে হবে।
          </div>
          {assignedUserId && (
            <div className="text-sm">
              <span className="text-muted-foreground">Client: </span>
              <span className="font-medium">{assignedClientName}</span>
              <span className="text-muted-foreground ml-2">Balance: </span>
              <span className={cn("font-medium", clientBalance <= 0 && "text-destructive")}>${clientBalance.toLocaleString()}</span>
            </div>
          )}
          <div>
            <Label>Amount (USD)</Label>
            <Input type="number" min="1" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} placeholder="Enter amount" />
          </div>
          {topUpAmount && Number(topUpAmount) > 0 && (
            <div className="text-sm text-muted-foreground">
              Current cap: <span className="font-medium text-foreground">${Number(topUpAccount?.spend_cap ?? 0).toLocaleString()}</span>
              {" → "}
              New cap: <span className="font-medium text-foreground">${(Number(topUpAccount?.spend_cap ?? 0) + Number(topUpAmount)).toLocaleString()}</span>
            </div>
          )}
          {willGoNegative && assignedUserId && (
            <p className="text-xs text-destructive">⚠️ This will make the client's balance negative</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopUpAccount(null)}>Cancel</Button>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => topUpMutation.mutate()} disabled={topUpMutation.isPending || !topUpAmount}>
              {topUpMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Top Up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Spend Cap Dialog */}
      <Dialog open={!!updateCapAccount} onOpenChange={(o) => !o && setUpdateCapAccount(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Spend Cap</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{updateCapAccount?.account_name} ({updateCapAccount?.account_id})</p>
          {updateCapAccount?.fraud_flag && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              এই অ্যাকাউন্টে spending cap mismatch পাওয়া গেছে। নতুন spend cap সেট করলে fraud flag রিসেট হবে।
            </div>
          )}
          <div>
            <Label>New Spend Cap (USD)</Label>
            <Input type="number" min="0" value={newSpendCap} onChange={(e) => setNewSpendCap(e.target.value)} placeholder="Enter exact spend cap" />
          </div>
          <div className="text-sm text-muted-foreground">
            Current cap: <span className="font-medium text-foreground">${Number(updateCapAccount?.spend_cap ?? 0).toLocaleString()}</span>
            {newSpendCap && <> → New: <span className="font-medium text-foreground">${Number(newSpendCap).toLocaleString()}</span></>}
          </div>
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-300">
            ⚠️ CRM এ spend cap সেট হবে। TikTok এও manually same value সেট করতে হবে।
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateCapAccount(null)}>Cancel</Button>
            <Button onClick={() => updateCapMutation.mutate()} disabled={updateCapMutation.isPending || !newSpendCap}>
              {updateCapMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Update Cap
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign {selectedIds.size} account(s) to client</DialogTitle>
          </DialogHeader>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                {assignClientId ? getClientName(assignClientId) : "Select client..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0">
              <Command>
                <CommandInput placeholder="Search client..." value={clientSearch} onValueChange={setClientSearch} />
                <CommandList>
                  <CommandEmpty>No client found</CommandEmpty>
                  <CommandGroup>
                    {filteredClients.map((c: any) => (
                      <CommandItem key={c.user_id} value={c.user_id} onSelect={(val) => setAssignClientId(val)}>
                        <Check className={cn("mr-2 h-4 w-4", assignClientId === c.user_id ? "opacity-100" : "opacity-0")} />
                        {c.full_name || c.email}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
            <Button onClick={() => assignMutation.mutate()} disabled={assignMutation.isPending || !assignClientId}>
              {assignMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unassign Confirm */}
      <AlertDialog open={showUnassignConfirm} onOpenChange={setShowUnassignConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unassign {selectedIds.size} account(s)?</AlertDialogTitle>
            <AlertDialogDescription>This will remove client assignments from selected accounts.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => unassignMutation.mutate()}>Unassign</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirm */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} account(s)?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the selected TikTok ad accounts and their assignments.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteMutation.mutate()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
