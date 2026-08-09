import { useState, useMemo, useEffect, useRef } from "react";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";

import { HoldBadge } from "@/components/HoldBadge";
import { SpendProgressBar } from "@/components/SpendProgressBar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowUpCircle, ExternalLink, Wallet, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown, RefreshCw, AppWindow, Search, ListChecks, Trash2, ChevronLeft, ChevronRight, MoreHorizontal, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CardBrandIcon } from "@/components/CardBrandIcon";
import { friendlyEdgeError } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { logSystemAction } from "@/lib/systemLog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ExternalTopUpDialog } from "@/components/admin/ExternalTopUpDialog";
import { InactiveBadge } from "@/components/InactiveBadge";
import { AdminUnusedAccountsView } from "@/components/AdminUnusedAccountsView";
import { useBillingVisits, formatVisitAge, type BillingVisit } from "@/lib/billingVisitTracker";

const PAGE_SIZE = 20;

interface InsightsData {
  today_spend: number;
  yesterday_spend: number;
  balance: number;
  billing_threshold?: number | null;
  daily_spend_limit_currency?: string | null;
  cards: { id: string; display_string: string; type: number }[];
  updated_at?: string;
  last_spend_date?: string | null;
}

const INSIGHTS_CACHE_KEY = "adminInsightsCache_v1";
const LAST_FULL_SYNC_KEY = "adminLastFullSync_v1";

function readInsightsLocalCache(): Record<string, InsightsData> | undefined {
  try {
    const raw = localStorage.getItem(INSIGHTS_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeInsightsLocalCache(data: Record<string, InsightsData>) {
  try {
    localStorage.setItem(INSIGHTS_CACHE_KEY, JSON.stringify(data));
  } catch {
    // quota / disabled — ignore
  }
}

function readLastFullSync(): number | null {
  try {
    const raw = localStorage.getItem(LAST_FULL_SYNC_KEY);
    if (!raw) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  } catch {
    return null;
  }
}

function writeLastFullSync(ts: number) {
  try {
    localStorage.setItem(LAST_FULL_SYNC_KEY, String(ts));
  } catch {
    // ignore
  }
}

// v1.4.2: runExtensionBillingSweep removed. Use ExtensionSyncButton per row instead.

export function AdminAdAccounts() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [topUpAccount, setTopUpAccount] = useState<any>(null);
  const [topUpWallet, setTopUpWallet] = useState<"primary" | "secondary">("primary");
  const [topUpAmount, setTopUpAmount] = useState("");
  const [externalTopUpAccount, setExternalTopUpAccount] = useState<any>(null);
  const [sortField, setSortField] = useState<string>(() => sessionStorage.getItem("adAccountsSortField") || "account_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => (sessionStorage.getItem("adAccountsSortDir") as "asc" | "desc") || "asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSelect, setShowSelect] = useState(false);
  const [lastSyncCalls, setLastSyncCalls] = useState<number | null>(null);
  const [lastSyncStatus, setLastSyncStatus] = useState<{ total: number; success: number; failed: number; autoRetried: number } | null>(null);
  const [lastFailedIds, setLastFailedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("adAccountsLastFailedIds");
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });
  const recordFailedIds = (ids: string[] | undefined, attemptedIds: string[]) => {
    setLastFailedIds(prev => {
      const next = new Set(prev);
      // Remove attempted ids that succeeded this run
      attemptedIds.forEach(id => next.delete(id));
      // Add newly failed
      (ids || []).forEach(id => next.add(id));
      try { localStorage.setItem("adAccountsLastFailedIds", JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const isInvalidOrExpiredAccount = (account: any) => {
    const bm: any = Array.isArray(account.business_managers) ? account.business_managers[0] : account.business_managers;
    const tokenExp = bm?.token_expires_at ? new Date(bm.token_expires_at).getTime() : null;
    return account.meta_account_status === 101
      || (tokenExp !== null && tokenExp < Date.now())
      || !bm?.access_token
      || !!(bm && bm.status && bm.status !== "active")
      || lastFailedIds.has(account.id);
  };
  const [search, setSearch] = useState(() => sessionStorage.getItem("adAccountsSearch") || "");
  useEffect(() => { sessionStorage.setItem("adAccountsSearch", search); }, [search]);
  const [statusFilter, setStatusFilter] = useState(() => sessionStorage.getItem("adAccountsStatusFilter") || "all");
  const [cardFilter, setCardFilter] = useState(() => sessionStorage.getItem("adAccountsCardFilter") || "all");
  const [activityFilter, setActivityFilter] = useState(() => sessionStorage.getItem("adAccountsActivityFilter") || "all");
  const [viewTab, setViewTab] = useState<"active" | "inventory" | "unused">(() => (sessionStorage.getItem("adAccountsViewTab") as "active" | "inventory" | "unused") || "active");
  useEffect(() => { sessionStorage.setItem("adAccountsViewTab", viewTab); }, [viewTab]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [currentPage, setCurrentPage] = useState(() => Number(sessionStorage.getItem("adAccountsPage")) || 1);
  const { visits: billingVisits, lastVisit: lastBillingVisit, recordVisit: recordBillingVisit, clearVisits: clearBillingVisits } = useBillingVisits();
  const billingVisitMap = useMemo(() => {
    const m = new Map<string, { visit: BillingVisit; rank: number }>();
    billingVisits.forEach((v, i) => m.set(v.accountId, { visit: v, rank: i }));
    return m;
  }, [billingVisits]);
  const [flashAccountId, setFlashAccountId] = useState<string | null>(null);
  const pendingJumpRef = useRef<string | null>(null);
  const handleJumpToLastBilling = () => {
    if (!lastBillingVisit) return;
    const targetId = lastBillingVisit.accountId;
    const acc = (accounts || []).find((a: any) => a.id === targetId);
    if (!acc) {
      toast.info("Account not found in current data.");
      return;
    }
    pendingJumpRef.current = targetId;
    // Ensure the account will be visible: switch tab if needed and clear filters
    const inAssigned = assignedSet.has(targetId);
    const desiredTab: "active" | "inventory" = inAssigned ? "active" : "inventory";
    if (viewTab !== desiredTab) setViewTab(desiredTab);
    if (search) setSearch("");
    if (statusFilter !== "all") setStatusFilter("all");
    if (cardFilter !== "all") setCardFilter("all");
    if (activityFilter !== "all") setActivityFilter("all");
  };
  useEffect(() => { sessionStorage.setItem("adAccountsSortField", sortField); }, [sortField]);
  useEffect(() => { sessionStorage.setItem("adAccountsSortDir", sortDir); }, [sortDir]);
  useEffect(() => { sessionStorage.setItem("adAccountsStatusFilter", statusFilter); }, [statusFilter]);
  useEffect(() => { sessionStorage.setItem("adAccountsCardFilter", cardFilter); }, [cardFilter]);
  useEffect(() => { sessionStorage.setItem("adAccountsActivityFilter", activityFilter); }, [activityFilter]);
  useEffect(() => { sessionStorage.setItem("adAccountsPage", String(currentPage)); }, [currentPage]);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignClientId, setAssignClientId] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [showUnassignConfirm, setShowUnassignConfirm] = useState(false);
  const [dialogTab, setDialogTab] = useState<"topup" | "withdraw">("topup");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawMeta, setWithdrawMeta] = useState<{ real_amount_spent: number; current_spend_cap: number; max_withdrawable: number } | null>(null);
  const [fetchingWithdrawMeta, setFetchingWithdrawMeta] = useState(false);
  const { data: accounts } = useQuery({
    queryKey: ["admin-ad-accounts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("ad_accounts")
        .select("*, business_managers(name, token_expires_at, access_token, status)")
        .eq("platform", "meta")
        .order("created_at", { ascending: false });
      return (data as any[]) ?? [];
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Realtime subscriptions removed — refresh only on manual "Update All from Meta" or user actions.
  // Prevents background refetch causing partial data (--/0) when tab is throttled.

  

  const { data: insights = {}, refetch: refetchInsights } = useQuery({
    queryKey: ["admin-insights-cache"],
    queryFn: async () => {
      if (!accounts || accounts.length === 0) return {};
      const ids = accounts.map((a: any) => a.id);
      const [edgeRes, dbRes, lastKnownRes] = await Promise.all([
        supabase.functions.invoke("get-account-insights", {
          body: { ad_account_ids: ids, source: "cache" },
        }),
        supabase.from("ad_account_insights").select("ad_account_id, cards, balance, billing_threshold, daily_spend_limit, hidden_daily_limit, daily_spend_limit_currency, daily_spend_limit_synced_at, today_spend, yesterday_spend, last_spend_date, updated_at, active_campaigns, today_orders, yesterday_orders, today_messages, yesterday_messages").in("ad_account_id", ids),
        supabase.from("ad_account_last_known_state").select("ad_account_id, cards, balance, spend_cap, amount_spent, last_spend_date, last_synced_at").in("ad_account_id", ids),
      ]);
      const edge = (edgeRes.data?.insights as Record<string, InsightsData>) ?? {};
      const lastKnownMap = new Map((lastKnownRes.data ?? []).map((row: any) => [row.ad_account_id, row]));
      // Merge DB row data so `cards` (and other fields) aren't lost when the edge cache lacks them
      (dbRes.data ?? []).forEach((row: any) => {
        const existing = edge[row.ad_account_id] ?? ({} as any);
        const lastKnown = lastKnownMap.get(row.ad_account_id) as any;
        const existingCards = existing.cards && existing.cards.length ? existing.cards : null;
        const rowCards = row.cards && row.cards.length ? row.cards : null;
        const lastKnownCards = lastKnown?.cards && lastKnown.cards.length ? lastKnown.cards : null;
        edge[row.ad_account_id] = {
          ...row,
          ...existing,
          cards: existingCards ?? rowCards ?? lastKnownCards ?? [],
          balance: Number(existing.balance ?? 0) > 0 ? existing.balance : Number(row.balance ?? 0) > 0 ? row.balance : lastKnown?.balance ?? row.balance,
          billing_threshold: existing.billing_threshold && Number(existing.billing_threshold) > 0 ? existing.billing_threshold : row.billing_threshold,
          daily_spend_limit_currency: existing.daily_spend_limit_currency || row.daily_spend_limit_currency,
          last_spend_date: existing.last_spend_date ?? row.last_spend_date ?? lastKnown?.last_spend_date ?? null,
          updated_at: existing.updated_at ?? row.updated_at ?? lastKnown?.last_synced_at,
        };
      });
      // Persist to localStorage so the next page reload can show data instantly
      writeInsightsLocalCache(edge);
      return edge;
    },
    enabled: !!accounts && accounts.length > 0,
    // Keep previously fetched data visible while refetching to avoid 0/-- flicker on tab return
    placeholderData: keepPreviousData,
    // Restore last successful fetch from localStorage so reload renders cached numbers instantly
    initialData: readInsightsLocalCache,
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000, // 5 min — only refetch in background after this
    // Refetch on mount when stale (e.g. fresh reload restoring localStorage cache) so data updates silently in background
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });


  const fetchWithdrawMeta = async (account: any) => {
    setWithdrawAmount("");
    setWithdrawMeta(null);
    setFetchingWithdrawMeta(true);
    try {
      const { data } = await supabase.functions.invoke("spend-cap-withdraw", {
        body: { ad_account_id: account.id, amount: 1, dry_run: true },
      });
      if (data?.max_withdrawable !== undefined) {
        setWithdrawMeta({
          real_amount_spent: data.real_amount_spent,
          current_spend_cap: data.current_spend_cap,
          max_withdrawable: data.max_withdrawable,
        });
      } else {
        setWithdrawMeta({
          real_amount_spent: Number(account.amount_spent),
          current_spend_cap: Number(account.spend_cap),
          max_withdrawable: Math.max(0, Number(account.spend_cap) - Number(account.amount_spent)),
        });
      }
    } catch {
      setWithdrawMeta({
        real_amount_spent: Number(account.amount_spent),
        current_spend_cap: Number(account.spend_cap),
        max_withdrawable: Math.max(0, Number(account.spend_cap) - Number(account.amount_spent)),
      });
    }
    setFetchingWithdrawMeta(false);
  };

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(withdrawAmount);
      const { data, error } = await supabase.functions.invoke("spend-cap-withdraw", {
        body: { ad_account_id: topUpAccount.id, amount: amt },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Withdrawn $${parseFloat(withdrawAmount).toLocaleString()} — Cap: $${Number(data.old_spend_cap).toLocaleString()} → $${Number(data.new_spend_cap).toLocaleString()}`);
      setTopUpAccount(null);
      setWithdrawAmount("");
      setWithdrawMeta(null);
      setDialogTab("topup");
      queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-wallets"] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-secondary-wallets"] });
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
  });

  const { data: assignments } = useQuery({
    queryKey: ["admin-user-ad-accounts"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("user_ad_accounts").select("*");
      return (data as any[]) ?? [];
    },
  });

  const { data: clients } = useQuery({
    queryKey: ["admin-clients-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, company, secondary_wallet_enabled, secondary_usd_rate" as any);
      return (data as any[]) ?? [];
    },
  });

  const { data: allWallets } = useQuery({
    queryKey: ["admin-all-wallets"],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("user_id, balance");
      return (data as any[]) ?? [];
    },
  });

  const { data: allSecondaryWallets } = useQuery({
    queryKey: ["admin-all-secondary-wallets"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("secondary_wallets").select("user_id, balance");
      return (data as any[]) ?? [];
    },
  });


  const refreshAllMutation = useMutation({
    mutationFn: async () => {
      // Only sync assigned accounts to save Meta API calls — inventory has its own button.
      const ids = assignedAccounts.map((a: any) => a.id);
      if (ids.length === 0) return;
      const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
      return await chunkedMetaSync(ids);
    },
    onSuccess: (data) => {
      const rl = data?.rate_limited;
      const failed = data?.failed_account_ids?.length ?? 0;
      const attempted = data?.attempted ?? assignedAccounts.length;
      const succeeded = data?.succeeded ?? (attempted - failed);
      const autoRetried = data?.auto_retried ?? 0;
      const refreshAllIds = assignedAccounts.map((a: any) => a.id);
      recordFailedIds(data?.failed_account_ids, refreshAllIds);
      setLastSyncStatus({ total: attempted, success: succeeded, failed, autoRetried });
      if (failed > 0) {
        toast.warning(`⚠️ ${succeeded}/${attempted} updated · ${failed} failed — click Update again to retry`);
      } else if (autoRetried > 0) {
        toast.success(`${attempted} updated (${autoRetried} auto-retried successfully)`);
      } else if (rl && rl.length > 0) {
        toast.warning(`⚠️ ${rl.length} account(s) rate-limited by Meta. Please retry after a few minutes.`);
      } else {
        toast.success(`${assignedAccounts.length} assigned account(s) updated from Meta`);
      }
      if (typeof data?.meta_calls === "number") setLastSyncCalls(data.meta_calls);
      // Record the time of this full sync — header timestamp updates only here
      const now = Date.now();
      writeLastFullSync(now);
      setLastFullSyncAt(now);
      refetchInsights();
      // v1.4.2: Mass extension billing sweep removed (Meta-detection risk).
      // For per-account live billing data, use the Sync button on each row.
      queryClient.invalidateQueries({ queryKey: ["billings-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["billings-insights"] });
      // Populate client_daily_stats for all users after Meta sync
      import("@/lib/populateDailyStats").then(m => m.populateClientDailyStats()).catch(console.error);
    },
    onError: (err: any) => toast.error(err.message || "Failed to refresh"),
  });

  const refreshInventoryMutation = useMutation({
    mutationFn: async () => {
      const ids = unassignedAccounts.map((a: any) => a.id);
      if (ids.length === 0) return;
      const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
      return await chunkedMetaSync(ids);
    },
    onSuccess: (data) => {
      const rl = data?.rate_limited;
      const failed = data?.failed_account_ids?.length ?? 0;
      const attempted = data?.attempted ?? unassignedAccounts.length;
      const succeeded = data?.succeeded ?? (attempted - failed);
      const autoRetried = data?.auto_retried ?? 0;
      recordFailedIds(data?.failed_account_ids, unassignedAccounts.map((a: any) => a.id));
      setLastSyncStatus({ total: attempted, success: succeeded, failed, autoRetried });
      if (failed > 0) {
        toast.warning(`⚠️ ${succeeded}/${attempted} inventory updated · ${failed} failed`);
      } else if (autoRetried > 0) {
        toast.success(`${attempted} inventory updated (${autoRetried} auto-retried)`);
      } else if (rl && rl.length > 0) {
        toast.warning(`⚠️ ${rl.length} inventory account(s) rate-limited by Meta.`);
      } else {
        toast.success(`${unassignedAccounts.length} inventory account(s) updated from Meta`);
      }
      if (typeof data?.meta_calls === "number") setLastSyncCalls(data.meta_calls);
      refetchInsights();
    },
    onError: (err: any) => toast.error(err.message || "Failed to refresh inventory"),
  });

  const refreshSelectedMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
      return await chunkedMetaSync(ids);
    },
    onSuccess: (data) => {
      const rl = data?.rate_limited;
      const failed = data?.failed_account_ids?.length ?? 0;
      const attempted = data?.attempted ?? selectedIds.size;
      const succeeded = data?.succeeded ?? (attempted - failed);
      const autoRetried = data?.auto_retried ?? 0;
      recordFailedIds(data?.failed_account_ids, Array.from(selectedIds));
      setLastSyncStatus({ total: attempted, success: succeeded, failed, autoRetried });
      if (failed > 0) {
        toast.warning(`⚠️ ${succeeded}/${attempted} updated · ${failed} failed — click Update again to retry`);
      } else if (autoRetried > 0) {
        toast.success(`${attempted} updated (${autoRetried} auto-retried)`);
      } else if (rl && rl.length > 0) {
        toast.warning(`⚠️ ${rl.length} of ${selectedIds.size} account(s) rate-limited. Please retry after a few minutes.`);
      } else {
        toast.success(`${selectedIds.size} account(s) updated from Meta`);
      }
      if (typeof data?.meta_calls === "number") setLastSyncCalls(data.meta_calls);
      refetchInsights();
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["billings-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["billings-insights"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to refresh"),
  });

  const [singleRefreshingId, setSingleRefreshingId] = useState<string | null>(null);
  const refreshSingleMutation = useMutation({
    mutationFn: async (accountId: string) => {
      setSingleRefreshingId(accountId);
      const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
      return await chunkedMetaSync([accountId]);
    },
    onSuccess: (data, accountId) => {
      const failed = data?.failed_account_ids?.length ?? 0;
      recordFailedIds(data?.failed_account_ids, [accountId]);
      if (failed > 0) {
        toast.warning("Account failed from Meta — added to Invalid / Expired Token filter");
      } else {
        toast.success("Account updated from Meta");
      }
      refetchInsights();
    },
    onError: (err: any) => toast.error(err.message || "Failed to refresh"),
    onSettled: () => setSingleRefreshingId(null),
  });

  const getAssignedUserId = (accountId: string) => {
    const assignment = assignments?.find((a: any) => a.ad_account_id === accountId);
    return assignment?.user_id ?? null;
  };

  const getClientName = (userId: string | null) => {
    if (!userId) return "Unassigned";
    const client = clients?.find((c: any) => c.user_id === userId);
    return client?.company || client?.full_name || client?.email || userId;
  };

  const getClientWallet = (userId: string | null) => {
    if (!userId) return null;
    return allWallets?.find((w: any) => w.user_id === userId);
  };

  /** True when the client has the secondary (sheet-rate) wallet enabled. */
  const hasSecondaryWallet = (userId: string | null) => {
    if (!userId) return false;
    return !!clients?.find((c: any) => c.user_id === userId)?.secondary_wallet_enabled;
  };

  const getSecondaryBalance = (userId: string | null) => {
    if (!userId) return 0;
    return Number(allSecondaryWallets?.find((w: any) => w.user_id === userId)?.balance ?? 0);
  };

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const { uniqueCards, uniqueBrands } = useMemo(() => {
    const cards = new Set<string>();
    const brands = new Set<string>();
    Object.values(insights).forEach((ins: any) => {
      ins?.cards?.forEach((c: any) => {
        cards.add(c.display_string);
        const lower = c.display_string?.toLowerCase() || "";
        if (lower.includes("visa")) brands.add("Visa");
        if (lower.includes("master")) brands.add("Mastercard");
        if (lower.includes("amex") || lower.includes("american")) brands.add("Amex");
      });
    });
    return { uniqueCards: Array.from(cards), uniqueBrands: Array.from(brands).sort() };
  }, [insights]);

  // Set of account IDs that are assigned (either via user_ad_accounts OR via ad_accounts.user_id)
  const assignedSet = useMemo(() => {
    const s = new Set<string>();
    (assignments || []).forEach((a: any) => { if (a.ad_account_id) s.add(a.ad_account_id); });
    (accounts || []).forEach((a: any) => { if (a.user_id) s.add(a.id); });
    return s;
  }, [assignments, accounts]);

  const assignedAccounts = useMemo(
    () => (accounts || []).filter((a: any) => assignedSet.has(a.id)),
    [accounts, assignedSet]
  );
  const unassignedAccounts = useMemo(
    () => (accounts || []).filter((a: any) => !assignedSet.has(a.id)),
    [accounts, assignedSet]
  );

  const sortedAccounts = useMemo(() => {
    const base = statusFilter === "invalid_or_expired"
      ? (accounts || [])
      : viewTab === "inventory" ? unassignedAccounts : assignedAccounts;
    const q = search.toLowerCase();
    return [...base]
      .filter((a: any) => {
        if (q && !a.account_name?.toLowerCase().includes(q) && !a.account_id?.toLowerCase().includes(q)) return false;
        if (statusFilter !== "all") {
          if (statusFilter === "invalid_or_expired") {
            if (!isInvalidOrExpiredAccount(a)) return false;
          } else if (a.status?.toLowerCase() !== statusFilter) {
            return false;
          }
        }
        if (cardFilter !== "all") {
          const ins = insights[a.id];
          if (["Visa","Mastercard","Amex"].includes(cardFilter)) {
            const brandKey = cardFilter.toLowerCase();
            const hasCard = ins?.cards?.some((c: any) => {
              const l = c.display_string?.toLowerCase() || "";
              return brandKey === "visa" ? l.includes("visa") :
                     brandKey === "mastercard" ? l.includes("master") :
                     l.includes("amex") || l.includes("american");
            });
            if (!hasCard) return false;
          } else {
            const hasCard = ins?.cards?.some((c: any) => c.display_string === cardFilter);
            if (!hasCard) return false;
          }
        }
        if (activityFilter !== "all") {
          const ins = insights[a.id];
          const lastSpend = ins?.last_spend_date;
          if (activityFilter === "never") {
            if (lastSpend) return false;
          } else {
            const days = parseInt(activityFilter);
            if (!lastSpend) return true; // no spend date = inactive
            const diffMs = Date.now() - new Date(lastSpend).getTime();
            const diffDays = diffMs / (1000 * 60 * 60 * 24);
            if (diffDays < days) return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        let valA: any, valB: any;
        const insA = insights[a.id];
        const insB = insights[b.id];
        switch (sortField) {
          case "account_name": valA = a.account_name?.toLowerCase(); valB = b.account_name?.toLowerCase(); break;
          case "today_spend": valA = insA?.today_spend ?? 0; valB = insB?.today_spend ?? 0; break;
          case "yesterday_spend": valA = insA?.yesterday_spend ?? 0; valB = insB?.yesterday_spend ?? 0; break;
          case "balance": {
            const balA = insA?.balance != null ? Number(insA.balance) : 0;
            const balB = insB?.balance != null ? Number(insB.balance) : 0;
            valA = balA; valB = balB; break;
          }
          case "spend_cap": valA = Number(a.spend_cap); valB = Number(b.spend_cap); break;
          default: valA = a.account_name?.toLowerCase(); valB = b.account_name?.toLowerCase();
        }
        if (valA < valB) return sortDir === "asc" ? -1 : 1;
        if (valA > valB) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
  }, [accounts, assignedAccounts, unassignedAccounts, viewTab, insights, sortField, sortDir, search, statusFilter, cardFilter, activityFilter, lastFailedIds]);

  const totalPages = Math.max(1, Math.ceil(sortedAccounts.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedAccounts = sortedAccounts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const filterResetRef = useRef(true);
  useEffect(() => {
    if (filterResetRef.current) { filterResetRef.current = false; return; }
    setCurrentPage(1);
  }, [search, statusFilter, cardFilter, activityFilter, viewTab]);

  // When a jump is pending, move to the correct page and scroll to the row once rendered
  useEffect(() => {
    const id = pendingJumpRef.current;
    if (!id) return;
    const idx = sortedAccounts.findIndex((a: any) => a.id === id);
    if (idx < 0) return; // filters/tab still updating
    const targetPage = Math.floor(idx / PAGE_SIZE) + 1;
    if (targetPage !== safePage) {
      setCurrentPage(targetPage);
      return;
    }
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-account-row="${id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlashAccountId(id);
        setTimeout(() => setFlashAccountId(null), 2000);
      }
      pendingJumpRef.current = null;
    }, 50);
    return () => clearTimeout(t);
  }, [sortedAccounts, safePage]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!paginatedAccounts.length) return;
    const pageIds = paginatedAccounts.map((a: any) => a.id);
    const allPageSelected = pageIds.every(id => selectedIds.has(id));
    if (allPageSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        pageIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        pageIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const allPageSelected = paginatedAccounts.length > 0 && paginatedAccounts.every((a: any) => selectedIds.has(a.id));

  const assignedUserId = topUpAccount ? getAssignedUserId(topUpAccount.id) : null;
  const assignedWallet = getClientWallet(assignedUserId);
  const assignedClientName = getClientName(assignedUserId);
  const clientBalance = Number(assignedWallet?.balance ?? 0);
  const assignedSecondaryEnabled = hasSecondaryWallet(assignedUserId);
  const assignedSecondaryBalance = getSecondaryBalance(assignedUserId);
  const parsedAmount = parseFloat(topUpAmount) || 0;
  const willGoNegative = topUpWallet === "secondary"
    ? parsedAmount > assignedSecondaryBalance
    : parsedAmount > clientBalance;

  const topUpMutation = useMutation({
    mutationFn: async (walletKind: "primary" | "secondary" = topUpWallet) => {
      const { data, error } = await supabase.functions.invoke("spend-cap-update", {
        body: {
          ad_account_id: topUpAccount.id,
          amount: parsedAmount,
          deduct_wallet: !!assignedUserId,
          target_user_id: assignedUserId,
          wallet_kind: walletKind,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Spend cap updated: $${Number(data.old_spend_cap).toLocaleString()} → $${Number(data.new_spend_cap).toLocaleString()}`);
      setTopUpAccount(null);
      setTopUpAmount("");
      queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-wallets"] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-secondary-wallets"] });
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
  });

  // Header "Synced X ago" reflects the last "Update All from Meta" run only.
  // Single-account refreshes do NOT update this — they only update that row's
  // own time inside the table. Persisted via localStorage so reload preserves it.
  const [lastFullSyncAt, setLastFullSyncAt] = useState<number | null>(() => readLastFullSync());
  const lastUpdated = useMemo(() => (lastFullSyncAt ? new Date(lastFullSyncAt) : null), [lastFullSyncAt]);

  const [timeAgoStr, setTimeAgoStr] = useState("");
  useEffect(() => {
    if (!lastUpdated) { setTimeAgoStr(""); return; }
    const update = () => {
      const diffMs = Date.now() - lastUpdated.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) setTimeAgoStr("just now");
      else if (diffSec < 3600) setTimeAgoStr(`${Math.floor(diffSec / 60)} min ago`);
      else if (diffSec < 86400) setTimeAgoStr(`${Math.floor(diffSec / 3600)} hr ago`);
      else setTimeAgoStr(`${Math.floor(diffSec / 86400)} day(s) ago`);
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className={cn("flex gap-2", isMobile ? "flex-col" : "items-center justify-between")}>
        <h1 className="text-xl md:text-2xl font-bold">All Ad Accounts</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {timeAgoStr && !isMobile && (
            <span className="text-xs text-muted-foreground">Synced {timeAgoStr}</span>
          )}
          {showSelect && selectedIds.size > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  <MoreHorizontal className="h-4 w-4 mr-1" />
                  Actions ({selectedIds.size})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => refreshSelectedMutation.mutate()} disabled={refreshSelectedMutation.isPending}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${refreshSelectedMutation.isPending ? 'animate-spin' : ''}`} />
                  Update Selected
                </DropdownMenuItem>
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
          {viewTab === "active" ? (
            <Button variant="outline" size="sm" onClick={() => refreshAllMutation.mutate()} disabled={refreshAllMutation.isPending || assignedAccounts.length === 0} className="text-xs">
              <RefreshCw className={`h-4 w-4 mr-1 ${refreshAllMutation.isPending ? 'animate-spin' : ''}`} />
              {refreshAllMutation.isPending ? "Updating..." : isMobile ? "Update All" : "Update All from Meta"}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => refreshInventoryMutation.mutate()} disabled={refreshInventoryMutation.isPending || unassignedAccounts.length === 0} className="text-xs">
              <RefreshCw className={`h-4 w-4 mr-1 ${refreshInventoryMutation.isPending ? 'animate-spin' : ''}`} />
              {refreshInventoryMutation.isPending ? "Syncing..." : "Sync All Inventory"}
            </Button>
          )}
        </div>
      </div>
      {(lastSyncCalls !== null || lastSyncStatus !== null) && (
        <div className="text-xs -mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {lastSyncStatus && (
            <span className={lastSyncStatus.failed > 0 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-emerald-600 dark:text-emerald-400 font-medium"}>
              {lastSyncStatus.success}/{lastSyncStatus.total} updated
              {lastSyncStatus.failed > 0 && ` · ${lastSyncStatus.failed} failed`}
              {lastSyncStatus.failed === 0 && lastSyncStatus.autoRetried > 0 && ` · ${lastSyncStatus.autoRetried} auto-retried`}
            </span>
          )}
          {lastSyncCalls !== null && (
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground">{lastSyncCalls}</span> Meta API call{lastSyncCalls === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      {/* View tabs: Active vs Inventory vs Unused */}
      <Tabs value={viewTab} onValueChange={(v) => setViewTab(v as "active" | "inventory" | "unused")}>
        <TabsList className="grid grid-cols-3 w-full sm:w-auto sm:inline-grid">
          <TabsTrigger value="active" className="text-xs sm:text-sm">
            Active Accounts
            <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">{assignedAccounts.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="inventory" className="text-xs sm:text-sm">
            Inventory
            <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">{unassignedAccounts.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="unused" className="text-xs sm:text-sm">
            Unused
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {viewTab === "inventory" && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          These accounts are not assigned to any client or agency. They are excluded from auto-sync and the
          "Update All from Meta" action to save Meta API calls. Assign an account to move it to <strong>Active Accounts</strong>.
        </div>
      )}

      {viewTab === "unused" && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Accounts grouped by client showing how many days each has been inactive. Use the 15/30/45-day tabs to filter.
        </div>
      )}

      {viewTab === "unused" && (
        <AdminUnusedAccountsView
          accounts={(assignedAccounts.concat(unassignedAccounts) || []).map((a: any) => {
            const ins = insights[a.id];
            const uid = getAssignedUserId(a.id);
            const client = uid ? clients?.find((c: any) => c.user_id === uid) : null;
            return {
              id: a.id,
              account_id: a.account_id,
              account_name: a.account_name,
              status: a.status,
              spend_cap: a.spend_cap,
              amount_spent: a.amount_spent,
              created_at: a.created_at,
              business_managers: a.business_managers,
              last_spend_date: ins?.last_spend_date ?? null,
              balance: ins?.balance ?? null,
              user_id: uid,
              client_name: client?.company ?? client?.full_name ?? null,
              client_email: client?.email ?? null,
            };
          })}
        />
      )}

      {viewTab !== "unused" && (
      <>
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
            <SelectItem value="unsettled">Unsettled</SelectItem>
            <SelectItem value="invalid_or_expired">Invalid / Expired Token</SelectItem>
          </SelectContent>
        </Select>
        <Select value={activityFilter} onValueChange={setActivityFilter}>
          <SelectTrigger className="w-[110px] md:w-[140px] h-9 text-xs">
            <SelectValue placeholder="Activity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Activity</SelectItem>
            <SelectItem value="15">Inactive 15d+</SelectItem>
            <SelectItem value="30">Inactive 30d+</SelectItem>
            <SelectItem value="45">Inactive 45d+</SelectItem>
            <SelectItem value="60">Inactive 60d+</SelectItem>
            <SelectItem value="never">Never Spent</SelectItem>
          </SelectContent>
        </Select>
        {!isMobile ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[160px] h-9 justify-between text-xs font-normal">
                {cardFilter === "all" ? "All Cards" : cardFilter}
                <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search last 4 digits..." className="h-8 text-xs" />
                <CommandList>
                  <CommandEmpty>No card found</CommandEmpty>
                  <CommandGroup>
                    <CommandItem value="all" onSelect={() => setCardFilter("all")}>
                      <Check className={cn("mr-2 h-3 w-3", cardFilter === "all" ? "opacity-100" : "opacity-0")} />
                      All Cards
                    </CommandItem>
                  </CommandGroup>
                  {uniqueBrands.length > 0 && (
                    <>
                      <CommandSeparator />
                      <CommandGroup heading="Card Brand">
                        {uniqueBrands.map((brand) => (
                          <CommandItem key={brand} value={brand} onSelect={() => setCardFilter(brand)}>
                            <Check className={cn("mr-2 h-3 w-3", cardFilter === brand ? "opacity-100" : "opacity-0")} />
                            <CardBrandIcon displayString={brand} size="xs" />
                            <span className="ml-1.5">{brand}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </>
                  )}
                  <CommandSeparator />
                  <CommandGroup heading="Individual Cards">
                    {uniqueCards.map((card) => (
                      <CommandItem key={card} value={card} onSelect={() => setCardFilter(card)}>
                        <Check className={cn("mr-2 h-3 w-3", cardFilter === card ? "opacity-100" : "opacity-0")} />
                        <CardBrandIcon displayString={card} size="xs" />
                        <span className="ml-1.5">{card}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : (
          <Select value={`${sortField}:${sortDir}`} onValueChange={(v) => { const [f, d] = v.split(":"); setSortField(f); setSortDir(d as "asc" | "desc"); }}>
            <SelectTrigger className="w-[120px] h-9 text-xs">
              <ArrowUpDown className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="account_name:asc">Name A-Z</SelectItem>
              <SelectItem value="account_name:desc">Name Z-A</SelectItem>
              <SelectItem value="today_spend:asc">Spend Low</SelectItem>
              <SelectItem value="today_spend:desc">Spend High</SelectItem>
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

      {lastBillingVisit && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <button
            type="button"
            onClick={handleJumpToLastBilling}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-primary hover:bg-primary/20 transition-colors"
            title="Scroll to the last ad account whose billing you opened"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="font-medium">Last billing:</span>
            <span className="truncate max-w-[180px]">{lastBillingVisit.accountName}</span>
            <span className="text-muted-foreground">· {formatVisitAge(lastBillingVisit.visitedAt)}</span>
          </button>
          {billingVisits.length > 1 && (
            <span className="text-muted-foreground">
              +{billingVisits.length - 1} more recent
            </span>
          )}
          <button
            type="button"
            onClick={clearBillingVisits}
            className="text-muted-foreground hover:text-destructive underline-offset-2 hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* Mobile Card Layout */}
      {isMobile ? (
        <div className="space-y-3">
          {paginatedAccounts.map((a: any) => {
            const ins = insights[a.id];
            const uid = getAssignedUserId(a.id);
            const clientName = getClientName(uid);
            const remaining = Math.max(0, Number(a.spend_cap) - Number(a.amount_spent));
            const ratio = Number(a.spend_cap) > 0 ? Number(a.amount_spent) / Number(a.spend_cap) : 0;
            const percentage = Math.min(ratio * 100, 100);
            const barColor = ratio >= 0.8 ? "bg-destructive" : ratio >= 0.5 ? "bg-yellow-500" : "bg-primary";

            return (
              <Card
                key={a.id}
                data-account-row={a.id}
                className={cn(
                  "border border-border/60 shadow-sm cursor-pointer active:scale-[0.98] transition-all",
                  billingVisitMap.get(a.id)?.rank === 0 && "border-l-4 border-l-primary",
                  flashAccountId === a.id && "ring-2 ring-primary"
                )}
                onClick={() => navigate(`/ad-accounts/${a.id}`)}
              >
                <CardContent className="p-4">
                  {/* Header: Name + Status */}
                  <div className="flex items-start justify-between mb-1">
                    {showSelect && (
                      <div className="pt-0.5 mr-2" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(a.id)} onCheckedChange={() => toggleSelect(a.id)} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {(() => {
                          const v = billingVisitMap.get(a.id);
                          if (!v) return null;
                          return (
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full shrink-0",
                                v.rank === 0 ? "bg-primary" : "bg-primary/40"
                              )}
                              title={`Billing visited ${formatVisitAge(v.visit.visitedAt)}`}
                            />
                          );
                        })()}
                        <p className="font-semibold text-sm text-foreground truncate">{a.account_name}</p>
                        {billingVisitMap.get(a.id)?.rank === 0 && (
                          <span className="text-[10px] text-primary font-medium shrink-0">· last</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[11px] text-muted-foreground font-mono">{a.account_id.replace(/^act_/, '')}</span>
                        <a href={`https://business.facebook.com/billing_hub/accounts/details?asset_id=${a.account_id.replace(/^act_/, '')}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary p-1 -m-1" onClick={(e) => { e.stopPropagation(); recordBillingVisit(a.id, a.account_name); }} title="New Billing">
                          <ExternalLink className="h-5 w-5" />
                        </a>
                        {a.platform !== "tiktok" && (
                          <a href={`https://business.facebook.com/billing_hub/payment_settings/?placement=ads_manager&asset_id=${a.account_id.replace(/^act_/, '')}&payment_account_id_from_jsmodule=${a.account_id.replace(/^act_/, '')}&entrypoint=ads_ecosystem_navigation_ads_billing_tool_plugin&payment_account_id=${a.account_id.replace(/^act_/, '')}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-muted-foreground hover:text-primary border border-border rounded px-1" onClick={(e) => { e.stopPropagation(); recordBillingVisit(a.id, a.account_name); }} title="Old Billing Link">
                            Old
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1"><StatusBadge status={a.status} /><HoldBadge accountId={a.id} compact /></div>
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

                  {/* Spent / Limit + Top Up */}
                  <div className="flex items-start justify-between gap-2 mt-2.5">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground min-w-0">
                      <span>Spent: <span className="font-medium text-foreground">${Number(a.amount_spent).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                      <span>Limit: <span className="font-medium text-foreground">${Number(a.spend_cap).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {a.external_topup_required ? (
                        <Button
                          size="sm"
                          className="gap-1 bg-amber-600 hover:bg-amber-700 text-white rounded-full px-4 font-semibold text-xs h-8"
                          onClick={() => setExternalTopUpAccount(a)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Ext. Top-Up
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            className="gap-1 bg-gradient-to-r from-primary to-primary/75 hover:from-primary/90 hover:to-primary/70 text-primary-foreground shadow-md shadow-primary/25 rounded-full px-4 font-semibold text-xs h-8"
                            onClick={() => { setTopUpAccount(a); setTopUpWallet("primary"); setTopUpAmount(""); setDialogTab("topup"); }}
                          >
                            <ArrowUpCircle className="h-3.5 w-3.5" />
                            Top Up
                          </Button>
                          {hasSecondaryWallet(uid) && (
                            <Button
                              size="icon"
                              className="h-8 w-8 shrink-0 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white"
                              title="Top Up (Secondary Wallet)"
                              onClick={() => { setTopUpAccount(a); setTopUpWallet("secondary"); setTopUpAmount(""); setDialogTab("topup"); }}
                            >
                              <ArrowUpCircle className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Insights row */}
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
                        <div className="flex items-center justify-center gap-1">
                          <p className="text-xs font-semibold">${Number(ins.balance ?? 0).toLocaleString()}</p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            disabled={singleRefreshingId === a.id}
                            onClick={(e) => { e.stopPropagation(); refreshSingleMutation.mutate(a.id); }}
                            title="Sync this account from Meta"
                          >
                            <RefreshCw className={cn("h-3 w-3", singleRefreshingId === a.id && "animate-spin")} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Client + Card + Last Refreshed + Refresh Button */}
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {uid ? (
                        <span className="text-primary cursor-pointer hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/clients/${uid}`); }}>{clientName}</span>
                      ) : "Unassigned"}
                    </span>
                    <div className="flex items-center gap-2">
                      {ins?.updated_at && (
                        <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(ins.updated_at), { addSuffix: true })}</span>
                      )}
                      <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          disabled={singleRefreshingId === a.id}
                          onClick={() => refreshSingleMutation.mutate(a.id)}
                          title="Refresh from Meta API"
                        >
                          <RefreshCw className={cn("h-3 w-3", singleRefreshingId === a.id && "animate-spin")} />
                        </Button>
                      </div>
                    </div>
                  </div>
                  {ins?.cards?.[0] && (
                    <div className="mt-1 flex items-center gap-1 text-xs">
                      <CardBrandIcon displayString={ins.cards[0].display_string} size="xs" />
                      <span className="text-muted-foreground">{ins.cards[0].display_string}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {(!accounts || accounts.length === 0) && (
            <p className="text-center text-muted-foreground py-8 text-sm">No ad accounts</p>
          )}
          {accounts && accounts.length > 0 && paginatedAccounts.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">No accounts match your filters</p>
          )}
        </div>
      ) : (
        /* Desktop Table */
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  {showSelect && (
                    <TableHead className="w-[40px]" onClick={(e) => e.stopPropagation()}>
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
                      <TableHead className="w-[110px]">
                    <button className="flex items-center text-xs font-medium" onClick={() => toggleSort("balance")}>
                          Balance / Th. <SortIcon field="balance" />
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
                  <TableHead className="w-[110px]"><span className="text-xs font-medium">Card Name</span></TableHead>
                  <TableHead className="w-[90px]"><span className="text-xs font-medium">Client</span></TableHead>
                  <TableHead className="w-[50px]"><span className="text-xs font-medium">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedAccounts.map((a: any) => {
                  const ins = insights[a.id];
                  return (
                    <TableRow
                      key={a.id}
                      data-account-row={a.id}
                      className={cn(
                        "cursor-pointer hover:bg-muted/50 transition-colors",
                        billingVisitMap.get(a.id)?.rank === 0 && "border-l-4 border-l-primary",
                        flashAccountId === a.id && "ring-2 ring-primary ring-inset"
                      )}
                      onClick={() => navigate(`/ad-accounts/${a.id}`)}
                      data-state={selectedIds.has(a.id) ? "selected" : undefined}
                    >
                      {showSelect && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selectedIds.has(a.id)} onCheckedChange={() => toggleSelect(a.id)} aria-label={`Select ${a.account_name}`} />
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                            <AppWindow className="h-4 w-4 text-muted-foreground" />
                          </div>
          <div>
                            <div className="flex items-center gap-1.5 min-w-0">
                              {(() => {
                                const v = billingVisitMap.get(a.id);
                                if (!v) return null;
                                return (
                                  <span
                                    className={cn(
                                      "h-2 w-2 rounded-full shrink-0",
                                      v.rank === 0 ? "bg-primary" : "bg-primary/40"
                                    )}
                                    title={`Billing visited ${formatVisitAge(v.visit.visitedAt)}`}
                                  />
                                );
                              })()}
                              <div className="text-sm text-primary">{a.account_name}</div>
                              {billingVisitMap.get(a.id)?.rank === 0 && (
                                <span className="text-[10px] text-primary font-medium px-1.5 py-0.5 rounded-full bg-primary/10 shrink-0">
                                  last visited · {formatVisitAge(billingVisitMap.get(a.id)!.visit.visitedAt)}
                                </span>
                              )}
                            </div>
                            {a.business_managers?.name && <div className="text-xs text-muted-foreground">{a.business_managers.name}</div>}
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground font-mono">{a.account_id.replace(/^act_/, '')}</span>
                              <a href={`https://business.facebook.com/billing_hub/accounts/details?asset_id=${a.account_id.replace(/^act_/, '')}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary p-1 -m-1" onClick={(e) => { e.stopPropagation(); recordBillingVisit(a.id, a.account_name); }} title="New Billing">
                                <ExternalLink className="h-5 w-5" />
                              </a>
                              {a.platform !== "tiktok" && (
                                <a href={`https://business.facebook.com/billing_hub/payment_settings/?placement=ads_manager&asset_id=${a.account_id.replace(/^act_/, '')}&payment_account_id_from_jsmodule=${a.account_id.replace(/^act_/, '')}&entrypoint=ads_ecosystem_navigation_ads_billing_tool_plugin&payment_account_id=${a.account_id.replace(/^act_/, '')}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-muted-foreground hover:text-primary border border-border rounded px-1" onClick={(e) => { e.stopPropagation(); recordBillingVisit(a.id, a.account_name); }} title="Old Billing Link">
                                  Old
                                </a>
                              )}
                            </div>
                            {ins?.updated_at && (
                              <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(ins.updated_at), { addSuffix: true })}</span>
                            )}
                            <div className="mt-1">
                              <InactiveBadge lastSpendDate={ins?.last_spend_date} fallbackDate={a.created_at} />
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <SpendProgressBar amountSpent={Number(a.amount_spent)} spendCap={Number(a.spend_cap)} balanceAfterTopup={Number((a as any).balance_after_topup ?? 0)} />
                      </TableCell>
                      <TableCell><div className="flex flex-col gap-1"><StatusBadge status={a.status} /><HoldBadge accountId={a.id} compact /></div></TableCell>
                      <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <span className="text-sm">${ins?.balance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6 border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground"
                            disabled={singleRefreshingId === a.id}
                            onClick={() => refreshSingleMutation.mutate(a.id)}
                            title="Sync this account from Meta"
                          >
                            <RefreshCw className={cn("h-3 w-3", singleRefreshingId === a.id && "animate-spin")} />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="text-sm">$ {ins?.today_spend?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="text-sm">$ {ins?.yesterday_spend?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</span>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm whitespace-nowrap">
                          {(() => {
                            const cards = ins?.cards ?? [];
                            const def = cards.find((c: any) => c.is_primary) ?? cards[0];
                            if (!def) return <span className="text-muted-foreground">—</span>;
                            const extra = cards.length - 1;
                            return (
                              <div className="flex items-center gap-1.5">
                                <CardBrandIcon displayString={def.display_string} size="xs" />
                                <span>{def.display_string}</span>
                                {extra > 0 && (
                                  <span className="text-[10px] text-muted-foreground">+{extra}</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const uid = getAssignedUserId(a.id);
                          const name = getClientName(uid);
                          return uid ? (
                            <span className="text-sm cursor-pointer hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/clients/${uid}`); }}>{name}</span>
                          ) : <span className="text-sm text-muted-foreground">{name}</span>;
                        })()}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                        {a.external_topup_required ? (
                          <Button
                            size="icon"
                            className="h-8 w-8 bg-amber-600 hover:bg-amber-700 text-white"
                            onClick={() => setExternalTopUpAccount(a)}
                            title={`Top-up via ${a.external_crm_name || "External CRM"}`}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        ) : (
                          <>
                            <Button size="icon" variant="default" className="h-8 w-8" onClick={() => { setTopUpAccount(a); setTopUpWallet("primary"); setTopUpAmount(""); setDialogTab("topup"); }} title="Top Up">
                              <ArrowUpCircle className="h-4 w-4" />
                            </Button>
                            {hasSecondaryWallet(getAssignedUserId(a.id)) && (
                              <Button
                                size="icon"
                                className="h-8 w-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                                title="Top Up (Secondary Wallet)"
                                onClick={() => { setTopUpAccount(a); setTopUpWallet("secondary"); setTopUpAmount(""); setDialogTab("topup"); }}
                              >
                                <ArrowUpCircle className="h-4 w-4" />
                              </Button>
                            )}
                          </>
                        )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!accounts || accounts.length === 0) && (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No ad accounts</TableCell></TableRow>
                )}
                {accounts && accounts.length > 0 && paginatedAccounts.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No accounts match your filters</TableCell></TableRow>
                )}
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
                        {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-xs text-muted-foreground">…</span>}
                        <Button variant={p === safePage ? "default" : "outline"} size="icon" className="h-8 w-8 text-xs" onClick={() => setCurrentPage(p)}>{p}</Button>
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

      {/* Pagination for mobile */}
      {isMobile && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            {((safePage - 1) * PAGE_SIZE) + 1}–{Math.min(safePage * PAGE_SIZE, sortedAccounts.length)} of {sortedAccounts.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={safePage <= 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs px-2">{safePage}/{totalPages}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={safePage >= totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      </>
      )}

      {/* Top Up / Withdraw Tabbed Dialog */}
      <Dialog open={!!topUpAccount} onOpenChange={(open) => { if (!open) { setTopUpAccount(null); setDialogTab("topup"); setWithdrawMeta(null); setWithdrawAmount(""); setTopUpAmount(""); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{topUpAccount?.account_name}</DialogTitle>
            <DialogDescription>{topUpAccount?.account_id?.replace(/^act_/, '')}</DialogDescription>
          </DialogHeader>
          <Tabs value={dialogTab} onValueChange={(v) => { const tab = v as "topup" | "withdraw"; setDialogTab(tab); if (tab === "withdraw" && !withdrawMeta && !fetchingWithdrawMeta && topUpAccount) fetchWithdrawMeta(topUpAccount); }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="topup">Increase Limit</TabsTrigger>
              <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
            </TabsList>
            <TabsContent value="topup" className="space-y-4 pt-2">
              {assignedUserId ? (
                <div className="p-3 rounded-lg bg-muted space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Assigned Client</span>
                    <span className="font-medium">{assignedClientName}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Main Wallet Balance</span>
                    <span className={`font-semibold ${clientBalance < 0 ? 'text-destructive' : ''}`}>${clientBalance.toLocaleString()}</span>
                  </div>
                  {assignedSecondaryEnabled && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400"><Wallet className="h-4 w-4" /> Secondary Wallet</span>
                      <span className={`font-semibold ${assignedSecondaryBalance < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400'}`}>${assignedSecondaryBalance.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-muted text-sm text-muted-foreground">No client assigned — wallet will not be deducted</div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Current Spend Cap</span>
                <span className="font-medium">${Number(topUpAccount?.spend_cap ?? 0).toLocaleString()}</span>
              </div>
              <div className="space-y-2">
                <Label>Amount to Add (USD)</Label>
                <Input type="number" min="1" step="0.01" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} placeholder="500.00" />
                {willGoNegative && parsedAmount > 0 && assignedUserId && (
                  <div className="flex items-center gap-2 text-sm text-yellow-600">
                    <AlertTriangle className="h-4 w-4" />
                    {topUpWallet === "secondary" ? "Secondary" : "Client"} balance will go negative by $
                    {(parsedAmount - (topUpWallet === "secondary" ? assignedSecondaryBalance : clientBalance)).toLocaleString()}
                  </div>
                )}
              </div>
              {parsedAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">New Spend Cap</span>
                  <span className="font-medium text-primary">${(Number(topUpAccount?.spend_cap ?? 0) + parsedAmount).toLocaleString()}</span>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setTopUpAccount(null)}>Cancel</Button>
                {assignedSecondaryEnabled && topUpWallet === "secondary" ? (
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => topUpMutation.mutate("secondary")}
                    disabled={!topUpAmount || parsedAmount <= 0 || topUpMutation.isPending}
                  >
                    {topUpMutation.isPending ? "Processing..." : "Top Up (Secondary)"}
                  </Button>
                ) : (
                  <Button
                    onClick={() => topUpMutation.mutate("primary")}
                    disabled={!topUpAmount || parsedAmount <= 0 || topUpMutation.isPending}
                  >
                    {topUpMutation.isPending ? "Processing..." : "Top Up Now"}
                  </Button>
                )}
              </DialogFooter>

            </TabsContent>
            <TabsContent value="withdraw" className="space-y-4 pt-2">
              {fetchingWithdrawMeta ? (
                <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Fetching real-time data from Meta...</span>
                </div>
              ) : withdrawMeta ? (
                <>
                  {assignedUserId ? (
                    <div className="p-3 rounded-lg bg-muted space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Assigned Client</span>
                        <span className="font-medium">{assignedClientName}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Client Wallet Balance</span>
                        <span className="font-semibold">${clientBalance.toLocaleString()}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-muted text-sm text-muted-foreground">No client assigned — wallet will not be credited</div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Current Spend Cap (Meta)</span>
                    <span className="font-medium">${withdrawMeta.current_spend_cap.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Amount Spent (Real-time)</span>
                    <span className="font-medium">${withdrawMeta.real_amount_spent.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold">
                    <span className="text-muted-foreground">Max Withdrawable</span>
                    <span className="text-primary">${withdrawMeta.max_withdrawable.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="space-y-2">
                    <Label>Withdraw Amount (USD)</Label>
                    <Input type="number" min="1" max={withdrawMeta.max_withdrawable} step="0.01" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder={`Max $${withdrawMeta.max_withdrawable.toFixed(2)}`} />
                    {parseFloat(withdrawAmount) > withdrawMeta.max_withdrawable && (
                      <div className="flex items-center gap-2 text-sm text-destructive">
                        <AlertTriangle className="h-4 w-4" /> Amount exceeds maximum withdrawable
                      </div>
                    )}
                  </div>
                  {parseFloat(withdrawAmount) > 0 && parseFloat(withdrawAmount) <= withdrawMeta.max_withdrawable && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">New Spend Cap</span>
                      <span className="font-medium text-primary">${(withdrawMeta.current_spend_cap - parseFloat(withdrawAmount)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setTopUpAccount(null)}>Cancel</Button>
                    <Button onClick={() => withdrawMutation.mutate()} disabled={!withdrawAmount || parseFloat(withdrawAmount) <= 0 || !withdrawMeta || parseFloat(withdrawAmount) > withdrawMeta.max_withdrawable || withdrawMutation.isPending} variant="destructive">
                      {withdrawMutation.isPending ? "Processing..." : "Withdraw Now"}
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <div className="text-center py-6 text-sm text-muted-foreground">Unable to fetch data. Please try again.</div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>


      <Dialog open={showAssignDialog} onOpenChange={(open) => { setShowAssignDialog(open); if (!open) setClientSearch(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign {selectedIds.size} Account(s) to Client</DialogTitle>
            <DialogDescription>Select a client to assign the selected ad accounts to. Existing assignments will be replaced.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <Label>Client</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                  {assignClientId
                    ? clients?.find((c: any) => c.user_id === assignClientId)?.full_name ||
                      clients?.find((c: any) => c.user_id === assignClientId)?.email || "Selected"
                    : "Select a client..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[350px] p-0">
                <Command>
                  <CommandInput placeholder="Search client by name or email..." />
                  <CommandList>
                    <CommandEmpty>No client found.</CommandEmpty>
                    <CommandGroup>
                      {clients?.map((c: any) => (
                        <CommandItem key={c.user_id} value={`${c.full_name || ""} ${c.email || ""}`} onSelect={() => setAssignClientId(c.user_id)}>
                          <Check className={`mr-2 h-4 w-4 ${assignClientId === c.user_id ? "opacity-100" : "opacity-0"}`} />
                          <div className="flex flex-col">
                            <span>{c.full_name || c.email}</span>
                            {c.full_name && c.email && <span className="text-xs text-muted-foreground">{c.email}</span>}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
            <Button disabled={!assignClientId} onClick={async () => {
              const ids = Array.from(selectedIds);
              await (supabase as any).from("user_ad_accounts").delete().in("ad_account_id", ids);
              const { error } = await (supabase as any).from("user_ad_accounts").insert(ids.map(adAccountId => ({ user_id: assignClientId, ad_account_id: adAccountId })));
              if (error) { toast.error(error.message); return; }
              const assignedClientName = clients?.find((c: any) => c.user_id === assignClientId)?.full_name || assignClientId.slice(0, 8);
              const accountNames = ids.map(id => accounts?.find((a: any) => a.id === id)?.account_name || id.slice(0, 8)).join(", ");
              await logSystemAction("Ad Account Assigned", `${accountNames} → ${assignedClientName}`);
              toast.success(`${ids.length} account(s) assigned`);
              setShowAssignDialog(false);
              setSelectedIds(new Set());
              queryClient.invalidateQueries({ queryKey: ["admin-user-ad-accounts"] });
            }}>
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unassign Selected Confirmation */}
      <AlertDialog open={showUnassignConfirm} onOpenChange={setShowUnassignConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unassign {selectedIds.size} Account(s)?</AlertDialogTitle>
            <AlertDialogDescription>This will remove client assignments from the selected ad accounts.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              const ids = Array.from(selectedIds);
              const { error } = await (supabase as any).from("user_ad_accounts").delete().in("ad_account_id", ids);
              if (error) { toast.error(error.message); return; }
              const unassignNames = ids.map(id => accounts?.find((a: any) => a.id === id)?.account_name || id.slice(0, 8)).join(", ");
              await logSystemAction("Ad Account Unassigned", unassignNames);
              toast.success(`${ids.length} account(s) unassigned`);
              setSelectedIds(new Set());
              queryClient.invalidateQueries({ queryKey: ["admin-user-ad-accounts"] });
            }}>
              Unassign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} Ad Account(s)?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the selected ad accounts and all associated data.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
              const ids = Array.from(selectedIds);
              // Clean ALL referencing rows first to avoid FK violations.
              // - bm_access_requests / top_up_requests / ad_account_requests use NO ACTION FK
              //   so we must delete (or null) them explicitly.
              // - The rest (insights, user_ad_accounts, failed_topups, auto_topup_rules,
              //   ad_campaign_rules, external_topup_requests, card_assignments,
              //   last_known_state, notes) cascade automatically — but we still clear
              //   insights explicitly for backwards-compat with older FK setups.
              try {
                await Promise.all([
                  (supabase as any).from("bm_access_requests").delete().in("ad_account_id", ids),
                  (supabase as any).from("top_up_requests").delete().in("ad_account_id", ids),
                  (supabase as any).from("ad_account_requests").update({ assigned_ad_account_id: null }).in("assigned_ad_account_id", ids),
                  supabase.from("ad_account_insights").delete().in("ad_account_id", ids),
                ]);
              } catch (cleanupErr: any) {
                console.warn("Pre-delete cleanup warning:", cleanupErr?.message || cleanupErr);
              }
              const { error } = await supabase.from("ad_accounts").delete().in("id", ids);
              if (error) { toast.error(error.message); } else {
                const deleteNames = ids.map(id => accounts?.find((a: any) => a.id === id)?.account_name || id.slice(0, 8)).join(", ");
                logSystemAction("Ad Account Deleted", deleteNames);
                toast.success(`${ids.length} ad account(s) deleted`);
                setSelectedIds(new Set());
                queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
                queryClient.invalidateQueries({ queryKey: ["admin-insights-cache"] });
                queryClient.invalidateQueries({ queryKey: ["billings-accounts"] });
                queryClient.invalidateQueries({ queryKey: ["billings-insights"] });
              }
            }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {externalTopUpAccount && (
        <ExternalTopUpDialog
          open={!!externalTopUpAccount}
          onOpenChange={(o) => { if (!o) setExternalTopUpAccount(null); }}
          account={externalTopUpAccount}
        />
      )}
    </div>
  );
}
