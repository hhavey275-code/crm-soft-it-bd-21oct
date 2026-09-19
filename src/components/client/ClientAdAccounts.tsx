import { matchesSearch } from "@/lib/searchNormalize";
import { useState, useMemo, useEffect, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { friendlyEdgeError } from "@/lib/utils";
import { FailedTopUps } from "@/components/FailedTopUps";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedCallback } from "@/lib/debounce";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { MetricCard } from "@/components/MetricCard";
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
import { ArrowUpCircle, ExternalLink, Wallet, ArrowUp, ArrowDown, ArrowUpDown, RefreshCw, AppWindow, Search, ListChecks, ChevronLeft, ChevronRight, DollarSign, ShoppingCart, MoreVertical, Pencil, Zap, Lock as LockIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { CardBrandIcon } from "@/components/CardBrandIcon";
import { useIsMobile } from "@/hooks/use-mobile";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { logSystemAction } from "@/lib/systemLog";
import { InactiveBadge } from "@/components/InactiveBadge";
import { tenantForward, isTenantInstance } from "@/lib/tenantForward";
import { ArrowDownCircle } from "lucide-react";
import { useWallets } from "@/hooks/useWallets";
import { startLimitWatch, useLimitWatches } from "@/hooks/useLimitUpdateWatch";
import { LimitUpdateIndicator } from "@/components/client/LimitUpdateIndicator";


const PAGE_SIZE = 20;

interface InsightsData {
  today_spend: number;
  yesterday_spend: number;
  today_orders: number;
  yesterday_orders: number;
  balance: number;
  cards: { id: string; display_string: string; type: number }[];
  updated_at?: string;
  last_spend_date?: string | null;
}

export function ClientAdAccounts() {
  const isMobile = useIsMobile();
  const { user, profile } = useAuth();
  const wallets = useWallets(user?.id);

  const queryClient = useQueryClient();
  // Live "Updating your limit..." indicators for external top-up requests.
  const limitWatches = useLimitWatches();
  const navigate = useNavigate();
  const [topUpAccount, setTopUpAccount] = useState<any>(null);
  const [topUpWallet, setTopUpWallet] = useState<"primary" | "secondary" | "credit_line">("primary");
  const [topUpAmount, setTopUpAmount] = useState("");
  const [sortField, setSortField] = useState<string>("account_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSelect, setShowSelect] = useState(false);
  const [lastSyncCalls, setLastSyncCalls] = useState<number | null>(null);
  const [search, setSearch] = useState(() => sessionStorage.getItem("adAccountsSearch") || "");
  useEffect(() => { sessionStorage.setItem("adAccountsSearch", search); }, [search]);
  const [statusFilter, setStatusFilter] = useState(() => sessionStorage.getItem("adAccountsStatusFilter") || "all");
  const [cardFilter, setCardFilter] = useState(() => sessionStorage.getItem("adAccountsCardFilter") || "all");
  const [currentPage, setCurrentPage] = useState(() => Number(sessionStorage.getItem("adAccountsPage")) || 1);
  useEffect(() => { sessionStorage.setItem("adAccountsStatusFilter", statusFilter); }, [statusFilter]);
  useEffect(() => { sessionStorage.setItem("adAccountsCardFilter", cardFilter); }, [cardFilter]);
  useEffect(() => { sessionStorage.setItem("adAccountsPage", String(currentPage)); }, [currentPage]);
  const [lastMetaUpdate, setLastMetaUpdate] = useState<number>(0);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);

  // Realtime subscription for live updates (debounced)
  const debouncedClientInvalidate = useDebouncedCallback(() => {
    if (!user?.id) return;
    queryClient.invalidateQueries({ queryKey: ["client-insights-cache", user.id] });
    queryClient.invalidateQueries({ queryKey: ["client-all-insights"] });
    queryClient.invalidateQueries({ queryKey: ["client-ad-accounts", user.id] });
    queryClient.invalidateQueries({ queryKey: ["client-dashboard-ad-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["client-wallet", user.id] });
  }, 1500);
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase.channel("client-realtime-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "ad_account_insights" }, () => debouncedClientInvalidate())
      .on("postgres_changes", { event: "*", schema: "public", table: "ad_accounts" }, () => debouncedClientInvalidate())
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${user.id}` }, () => debouncedClientInvalidate())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, debouncedClientInvalidate]);

  // BM Request state
  const [bmReqAccount, setBmReqAccount] = useState<any>(null);
  const [bmReqForm, setBmReqForm] = useState({ bm_name: "", bm_id: "" });
  const [bmReqLoading, setBmReqLoading] = useState(false);

  // Spend Cap Withdraw state
  const [withdrawAccount, setWithdrawAccount] = useState<any>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawNote, setWithdrawNote] = useState("");
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawMax, setWithdrawMax] = useState<number | null>(null);
  const [withdrawMaxLoading, setWithdrawMaxLoading] = useState(false);
  const [isTenantMode, setIsTenantMode] = useState(false);

  /** Admin-granted permission to pull unused ad account balance back to wallet. */
  const { data: canWithdraw } = useQuery({
    queryKey: ["client-can-withdraw", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("profiles")
        .select("spend_cap_withdraw_enabled")
        .eq("user_id", user!.id)
        .maybeSingle();
      return !!data?.spend_cap_withdraw_enabled;
    },
  });

  const openWithdraw = async (a: any) => {
    setWithdrawAccount(a);
    setWithdrawAmount("");
    setWithdrawNote("");
    setWithdrawMax(null);
    if (!canWithdraw) return;
    setWithdrawMaxLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("spend-cap-withdraw", {
        body: { ad_account_id: a.id, amount: 1, dry_run: true },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setWithdrawMax(Number((data as any)?.max_withdrawable ?? 0));
    } catch (err: any) {
      toast.error(friendlyEdgeError(err) || "Could not read live limit from Meta");
    } finally {
      setWithdrawMaxLoading(false);
    }
  };


  useEffect(() => {
    isTenantInstance().then(setIsTenantMode);
  }, []);

  // Rename state
  const [renameAccount, setRenameAccount] = useState<any>(null);
  const [renameName, setRenameName] = useState("");

  // Auto top-up state
  const [autoTopupAccount, setAutoTopupAccount] = useState<any>(null);
  const [autoTopupThreshold, setAutoTopupThreshold] = useState("");
  const [autoTopupAmount, setAutoTopupAmount] = useState("");

  const handleBmReqSubmit = async () => {
    if (!bmReqForm.bm_name || !bmReqForm.bm_id || !bmReqAccount) return;
    setBmReqLoading(true);
    try {
      const { error } = await (supabase as any).from("bm_access_requests").insert({
        user_id: user!.id,
        ad_account_id: bmReqAccount.id,
        bm_name: bmReqForm.bm_name,
        bm_id: bmReqForm.bm_id,
      });
      if (error) throw error;
      await logSystemAction("BM Access Requested", `BM "${bmReqForm.bm_name}" (${bmReqForm.bm_id}) for account ${bmReqAccount.account_name}`, user!.id, profile?.full_name || user!.email);

      const bmForward = await tenantForward("bm_share_request", {
        tenant_user_id: user!.id,
        tenant_user_name: profile?.full_name || user!.email,
        ad_account_external_id: bmReqAccount.account_id,
        ad_account_name: bmReqAccount.account_name,
        bm_id: bmReqForm.bm_id,
        bm_name: bmReqForm.bm_name,
        note: null,
      });
      if (!bmForward.ok && !bmForward.skipped) {
        toast.warning("Saved locally — failed to notify master support");
      }

      toast.success("BM access request submitted!");
      setBmReqAccount(null);
      setBmReqForm({ bm_name: "", bm_id: "" });
    } catch (err: any) {
      toast.error(err.message || "Failed to submit request");
    } finally {
      setBmReqLoading(false);
    }
  };

  const handleWithdrawSubmit = async () => {
    if (!withdrawAccount || !withdrawAmount) return;
    const amount = parseFloat(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setWithdrawLoading(true);
    try {
      // Permission granted → withdraw straight from Meta into the wallet.
      if (canWithdraw) {
        const { data, error } = await supabase.functions.invoke("spend-cap-withdraw", {
          body: { ad_account_id: withdrawAccount.id, amount },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        await logSystemAction(
          "Spend Cap Withdraw",
          `$${amount} withdrawn from ${withdrawAccount.account_name} to wallet`,
          user!.id,
          profile?.full_name || user!.email,
        );
        const capFrom = (data as any)?.old_spend_cap;
        const capTo = (data as any)?.new_spend_cap;
        toast.success(
          capFrom != null && capTo != null
            ? `$${amount} moved back to your wallet — limit $${Number(capFrom).toLocaleString()} → $${Number(capTo).toLocaleString()}`
            : `$${amount} moved back to your wallet`,
        );
        queryClient.invalidateQueries({ queryKey: ["client-ad-accounts", user!.id] });
        queryClient.invalidateQueries({ queryKey: ["client-wallet", user!.id] });
        queryClient.invalidateQueries({ queryKey: ["dual-wallets"] });
        setWithdrawAccount(null);
        setWithdrawAmount("");
        setWithdrawNote("");
        return;
      }

      const { error } = await (supabase as any).from("spend_cap_withdraw_requests").insert({
        user_id: user!.id,
        ad_account_id: withdrawAccount.id,
        amount_usd: amount,
        note: withdrawNote || null,
      });
      if (error) throw error;
      await logSystemAction(
        "Spend Cap Withdraw Requested",
        `$${amount} from ${withdrawAccount.account_name}${withdrawNote ? ` — ${withdrawNote}` : ""}`,
        user!.id,
        profile?.full_name || user!.email
      );
      const withdrawForward = await tenantForward("spend_cap_withdraw_request", {
        tenant_user_id: user!.id,
        tenant_user_name: profile?.full_name || user!.email,
        ad_account_external_id: withdrawAccount.account_id,
        ad_account_name: withdrawAccount.account_name,
        amount_usd: amount,
        note: withdrawNote || null,
      });
      if (!withdrawForward.ok && !withdrawForward.skipped) {
        toast.warning("Saved locally — failed to notify master support");
      }
      toast.success("Withdraw request submitted!");
      setWithdrawAccount(null);
      setWithdrawAmount("");
      setWithdrawNote("");
    } catch (err: any) {
      toast.error(err.message || "Failed to submit request");
    } finally {
      setWithdrawLoading(false);
    }
  };

  const renameMutation = useMutation({
    mutationFn: async () => {
      if (!renameAccount || !renameName.trim()) throw new Error("Enter a name");
      const { data, error } = await supabase.functions.invoke("rename-ad-account", {
        body: { ad_account_id: renameAccount.id, new_name: renameName.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Renamed: ${data.old_name} → ${data.new_name}`);
      setRenameAccount(null);
      setRenameName("");
      queryClient.invalidateQueries({ queryKey: ["client-ad-accounts"] });
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
  });

  const isInactive = (profile as any)?.status === "inactive";
  // Each wallet has its own due limit; an expired limit counts as zero.
  const notExpired = (ts?: string | null) => !ts || new Date(ts).getTime() > Date.now();
  const dueLimit = notExpired((profile as any)?.due_limit_expires_at)
    ? Number((profile as any)?.due_limit ?? 0)
    : 0;
  const secondaryDueLimit = notExpired((profile as any)?.secondary_due_limit_expires_at)
    ? Number((profile as any)?.secondary_due_limit ?? 0)
    : 0;
  const creditLineDueLimit = notExpired((profile as any)?.credit_line_due_limit_expires_at)
    ? Number((profile as any)?.credit_line_due_limit ?? 0)
    : 0;
  // Renaming an ad account is an admin-granted permission (off by default).
  const canRename = !!(profile as any)?.account_rename_enabled;
  const META_COOLDOWN_MS = 10 * 60 * 1000;

  const { data: accounts = [] } = useQuery({
    queryKey: ["client-ad-accounts", user?.id],
    queryFn: async () => {
      const { data: assignments } = await (supabase as any)
        .from("user_ad_accounts")
        .select("ad_account_id")
        .eq("user_id", user!.id);
      if (!assignments || assignments.length === 0) return [];
      const accountIds = assignments.map((a: any) => a.ad_account_id);
      const { data } = await supabase.from("ad_accounts").select("*, business_managers(name)").in("id", accountIds);
      return (data as any[]) ?? [];
    },
    enabled: !!user,
    staleTime: 2 * 60_000,
  });

  const { data: insights = {}, refetch: refetchInsights } = useQuery({
    queryKey: ["client-insights-cache", user?.id],
    queryFn: async () => {
      if (!accounts || accounts.length === 0) return {};
      const ids = accounts.map((a: any) => a.id);
      const { data } = await supabase.functions.invoke("get-account-insights", {
        body: { ad_account_ids: ids, source: "cache" },
      });
      return (data?.insights as Record<string, InsightsData>) ?? {};
    },
    enabled: !!user && !!accounts && accounts.length > 0,
    staleTime: 60_000,
    refetchOnMount: "always",
  });

  const hasAutoRefreshed = useRef(false);
  useEffect(() => {
    if (!accounts || accounts.length === 0 || hasAutoRefreshed.current) return;
    hasAutoRefreshed.current = true;

    // Check sessionStorage — if already synced this session, skip
    const lastSessionSync = sessionStorage.getItem("metaSyncTimestamp");
    if (lastSessionSync) {
      setLastMetaUpdate(Number(lastSessionSync));
      return; // Already synced this session, serve from cache
    }

    setIsAutoSyncing(true);
    const ids = accounts.map((a: any) => a.id);
    import("@/lib/chunkedMetaSync").then(({ chunkedMetaSync }) =>
      chunkedMetaSync(ids)
    ).then((result) => {
      const now = Date.now();
      if (result?.insights) {
        queryClient.setQueryData(["client-insights-cache", user?.id], result.insights);
        queryClient.invalidateQueries({ queryKey: ["client-ad-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["client-all-insights"] });
        setLastMetaUpdate(now);
        sessionStorage.setItem("metaSyncTimestamp", String(now));
      }
      if (result?.rate_limited?.length > 0) {
        toast.warning(`${result.rate_limited.length} account(s) rate-limited by Meta`);
      }
      // Populate daily stats
      if (user?.id) {
        import("@/lib/populateDailyStats").then(m => m.populateClientDailyStats(user.id)).catch(console.error);
      }
    }).catch((err) => {
      console.error("Auto-refresh failed:", err);
    }).finally(() => {
      setIsAutoSyncing(false);
    });
  }, [accounts]);

  const { data: wallet } = useQuery({
    queryKey: ["client-wallet", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("balance").eq("user_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  // Check if user has auto_topup permission
  const { data: hasAutoTopupPermission = false } = useQuery({
    queryKey: ["auto-topup-permission", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any).from("menu_permissions").select("id").eq("user_id", user!.id).eq("menu_key", "auto_topup").maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Auto top-up rules query (only if permitted)
  const { data: autoTopupRules = [] } = useQuery({
    queryKey: ["auto-topup-rules", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any).from("auto_topup_rules").select("*").eq("user_id", user!.id);
      return data ?? [];
    },
    enabled: !!user && hasAutoTopupPermission,
  });

  const autoTopupRulesMap = useMemo(() => {
    const map: Record<string, any> = {};
    autoTopupRules.forEach((r: any) => { map[r.ad_account_id] = r; });
    return map;
  }, [autoTopupRules]);

  const saveAutoTopupMutation = useMutation({
    mutationFn: async ({ accountId, threshold, amount, isActive }: { accountId: string; threshold: number; amount: number; isActive: boolean }) => {
      const existing = autoTopupRulesMap[accountId];
      if (existing) {
        const { error } = await (supabase as any).from("auto_topup_rules").update({
          threshold_balance: threshold,
          topup_amount: amount,
          is_active: isActive,
        }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("auto_topup_rules").insert({
          user_id: user!.id,
          ad_account_id: accountId,
          threshold_balance: threshold,
          topup_amount: amount,
          is_active: isActive,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Auto top-up rule saved!");
      setAutoTopupAccount(null);
      queryClient.invalidateQueries({ queryKey: ["auto-topup-rules"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to save rule"),
  });

  const deleteAutoTopupMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const { error } = await (supabase as any).from("auto_topup_rules").delete().eq("id", ruleId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Auto top-up rule removed");
      setAutoTopupAccount(null);
      queryClient.invalidateQueries({ queryKey: ["auto-topup-rules"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete rule"),
  });

  const checkCooldown = (): boolean => {
    const now = Date.now();
    const elapsed = now - lastMetaUpdate;
    if (elapsed < META_COOLDOWN_MS) {
      const remainingMin = Math.ceil((META_COOLDOWN_MS - elapsed) / 60000);
      toast.error(`Please wait ${remainingMin} minute(s) before updating again.`);
      return false;
    }
    return true;
  };

  const refreshAllMutation = useMutation({
    mutationFn: async () => {
      if (!checkCooldown()) throw new Error("cooldown");
      if (!accounts || accounts.length === 0) return;
      const ids = accounts.map((a: any) => a.id);
      const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
      return await chunkedMetaSync(ids);
    },
    onSuccess: (data) => {
      const now = Date.now();
      setLastMetaUpdate(now);
      sessionStorage.setItem("metaSyncTimestamp", String(now));
      const rl = data?.rate_limited;
      if (rl && rl.length > 0) {
        toast.warning(`⚠️ ${rl.length} account(s) could not be updated due to Meta API rate limits. Please retry after a few minutes.`);
      } else {
        toast.success("All accounts updated from Meta");
      }
      if (typeof data?.meta_calls === "number") setLastSyncCalls(data.meta_calls);
      // Force a fresh DB read of the cache so the "Last synced" label updates immediately.
      queryClient.invalidateQueries({ queryKey: ["client-insights-cache", user?.id] });
      refetchInsights();
      // Invalidate dashboard queries so dashboard picks up fresh data
      // Also invalidate ad_accounts query so fresh spend_cap / amount_spent
      // (written by get-account-insights) flow into Remaining/SpendProgressBar.
      queryClient.invalidateQueries({ queryKey: ["client-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["client-all-insights"] });
      queryClient.invalidateQueries({ queryKey: ["client-dashboard-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["client-daily-stats"] });
      // Populate client_daily_stats for current user after Meta sync
      if (user?.id) {
        import("@/lib/populateDailyStats").then(m => m.populateClientDailyStats(user.id)).catch(console.error);
      }
    },
    onError: (err: any) => {
      if (err.message !== "cooldown") toast.error(err.message || "Failed to refresh");
    },
  });

  const refreshSelectedMutation = useMutation({
    mutationFn: async () => {
      if (!checkCooldown()) throw new Error("cooldown");
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
      return await chunkedMetaSync(ids);
    },
    onSuccess: (data) => {
      setLastMetaUpdate(Date.now());
      const rl = data?.rate_limited;
      if (rl && rl.length > 0) {
        toast.warning(`⚠️ ${rl.length} of ${selectedIds.size} account(s) rate-limited. Please retry after a few minutes.`);
      } else {
        toast.success(`${selectedIds.size} account(s) updated from Meta`);
      }
      if (typeof data?.meta_calls === "number") setLastSyncCalls(data.meta_calls);
      refetchInsights();
      setSelectedIds(new Set());
      // Refresh ad_accounts so spend_cap/amount_spent update in Remaining UI
      queryClient.invalidateQueries({ queryKey: ["client-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["client-dashboard-ad-accounts"] });
    },
    onError: (err: any) => {
      if (err.message !== "cooldown") toast.error(err.message || "Failed to refresh");
    },
  });


  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const uniqueCards = useMemo(() => {
    const cards = new Set<string>();
    Object.values(insights).forEach((ins: any) => {
      ins?.cards?.forEach((c: any) => cards.add(c.display_string));
    });
    return Array.from(cards);
  }, [insights]);

  const sortedAccounts = useMemo(() => {
    if (!accounts) return [];
    const q = search;
    return [...accounts]
      .filter((a: any) => {
        if (q && !matchesSearch(q, a.account_name, a.account_id)) return false;
        if (statusFilter !== "all" && a.status?.toLowerCase() !== statusFilter) return false;
        if (cardFilter !== "all") {
          const ins = insights[a.id];
          const hasCard = ins?.cards?.some((c: any) => c.display_string === cardFilter);
          if (!hasCard) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let valA: any, valB: any;
        switch (sortField) {
          case "account_name": valA = a.account_name?.toLowerCase(); valB = b.account_name?.toLowerCase(); break;
          case "spend_cap": {
            const insA = insights[a.id];
            const insB = insights[b.id];
            valA = insA?.balance != null ? Number(insA.balance) : Math.max(0, Number(a.spend_cap) - Number(a.amount_spent));
            valB = insB?.balance != null ? Number(insB.balance) : Math.max(0, Number(b.spend_cap) - Number(b.amount_spent));
            break;
          }
          case "balance": valA = Number(a.spend_cap); valB = Number(b.spend_cap); break;
          default: valA = a.account_name?.toLowerCase(); valB = b.account_name?.toLowerCase();
        }
        if (valA < valB) return sortDir === "asc" ? -1 : 1;
        if (valA > valB) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
  }, [accounts, insights, sortField, sortDir, search, statusFilter, cardFilter]);

  const totalPages = Math.max(1, Math.ceil(sortedAccounts.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedAccounts = sortedAccounts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const filterResetRef = useRef(true);
  useEffect(() => {
    if (filterResetRef.current) { filterResetRef.current = false; return; }
    setCurrentPage(1);
  }, [search, statusFilter, cardFilter]);

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

  const walletBalance = Number(wallet?.balance ?? 0);
  // External CRM accounts (no API connection) go through a request flow instead
  const isExternalTopUp = !!topUpAccount?.external_topup_required;
  const isSecondaryTopUp = topUpWallet === "secondary";
  const isCreditLineTopUp = topUpWallet === "credit_line";
  // Secondary and credit line wallets behave the same way: they hold their own
  // balance, can be funded from the main wallet at the rate difference, and
  // have their own due limit.
  const isAltTopUp = isSecondaryTopUp || isCreditLineTopUp;
  const secondaryBalance = Number(wallets.secondaryBalance ?? 0);
  const creditLineBalance = Number(wallets.creditLineBalance ?? 0);
  const mainRate = Number(wallets.mainRate ?? 0);
  const altRate =
    Number(isCreditLineTopUp ? wallets.creditLineRate : wallets.secondaryRate ?? 0) || mainRate;
  const altBalance = isCreditLineTopUp ? creditLineBalance : secondaryBalance;
  const altDueLimit = isCreditLineTopUp ? creditLineDueLimit : secondaryDueLimit;
  // Alt top-ups draw on: their own balance → main wallet's POSITIVE balance
  // (rate converted) → that wallet's own due limit. The main wallet's due
  // limit is never usable on an alt top-up.
  const mainToSecondaryFactor = altRate > 0 && mainRate > 0 ? mainRate / altRate : 1;
  const activeDueLimit = isAltTopUp ? altDueLimit : dueLimit;
  const mainSurplusAsSecondary = Math.max(0, walletBalance) * mainToSecondaryFactor;
  const activeWalletBalance = isAltTopUp ? altBalance : walletBalance;
  const effectiveBalance = isAltTopUp
    ? altBalance + mainSurplusAsSecondary + altDueLimit
    : walletBalance + dueLimit;
  const parsedAmount = parseFloat(topUpAmount) || 0;
  const exceedsBalance = parsedAmount > effectiveBalance + 0.01;
  const secondaryShortfall = isAltTopUp ? Math.max(0, parsedAmount - altBalance) : 0;
  const convertFromMain =
    secondaryShortfall > 0 && mainToSecondaryFactor > 0
      ? Math.min(secondaryShortfall / mainToSecondaryFactor, Math.max(0, walletBalance))
      : 0;
  const secondaryDueUsed = isAltTopUp
    ? Math.max(0, secondaryShortfall - convertFromMain * mainToSecondaryFactor)
    : 0;
  const usingDueLimit = isAltTopUp
    ? secondaryDueUsed > 0.01 && !exceedsBalance
    : parsedAmount > walletBalance && parsedAmount <= effectiveBalance;

  // 30s gap between external top-up requests (server-enforced too) so the CRM
  // helper can finish one top-up before the next request is queued.
  const [externalCooldownUntil, setExternalCooldownUntil] = useState<number | null>(null);
  const [cooldownNow, setCooldownNow] = useState(() => Date.now());
  useEffect(() => {
    if (!externalCooldownUntil) return;
    const t = setInterval(() => setCooldownNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [externalCooldownUntil]);
  const externalCooldownLeft = externalCooldownUntil
    ? Math.max(0, Math.ceil((externalCooldownUntil - cooldownNow) / 1000))
    : 0;

  const externalRequestMutation = useMutation({
    mutationFn: async (walletKind: "primary" | "secondary" | "credit_line") => {
      const { data, error } = await (supabase as any).rpc("request_external_topup", {
        p_ad_account_id: topUpAccount.id,
        p_amount: parsedAmount,
        p_wallet_kind: walletKind,
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) {
        if (data?.error === "cooldown_active") {
          const secs = Number(data?.wait_seconds ?? 30);
          const err: any = new Error(
            data?.scope === "own"
              ? `Please wait ${secs}s — external top-up requests are processed one by one (30s gap).`
              : `Another external top-up is being processed. Please try again in ${secs}s.`,
          );
          err.waitSeconds = secs;
          throw err;
        }
        const map: Record<string, string> = {
          insufficient_balance: "Insufficient fund",
          account_not_assigned: "This ad account is not assigned to you",
          crm_url_not_configured: "Top-up is not configured for this wallet",
          not_external_account: "This account does not use external top-up",
          invalid_amount: "Enter a valid amount",
        };
        throw new Error(map[data?.error] || data?.error || "Failed to submit request");
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Top-up request submitted! Our team will process it shortly.");
      setExternalCooldownUntil(Date.now() + 30_000);
      const watchedId = topUpAccount?.id;
      const watchedCap = Number(topUpAccount?.spend_cap ?? 0);
      setTopUpAccount(null);
      setTopUpAmount("");
      // Watch Meta for the new spending limit at 10s / 30s / 60s.
      if (watchedId) {
        startLimitWatch(watchedId, watchedCap, () => {
          queryClient.invalidateQueries({ queryKey: ["client-ad-accounts"] });
          queryClient.invalidateQueries({ queryKey: ["client-dashboard-ad-accounts"] });
          queryClient.invalidateQueries({ queryKey: ["client-insights-cache"] });
        });
      }
      queryClient.invalidateQueries({ queryKey: ["client-wallet"] });
      queryClient.invalidateQueries({ queryKey: ["dual-wallets"] });
      queryClient.invalidateQueries({ queryKey: ["client-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["client-dashboard-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["client-external-topup-requests"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to submit request");
      if (typeof err?.waitSeconds === "number" && err.waitSeconds > 0) {
        setExternalCooldownUntil(Date.now() + err.waitSeconds * 1000);
      }
    },
  });

  const topUpMutation = useMutation({
    mutationFn: async (walletKind: "primary" | "secondary" | "credit_line" = "primary") => {
      const { data, error } = await supabase.functions.invoke("spend-cap-update", {
        body: { ad_account_id: topUpAccount.id, amount: parsedAmount, deduct_wallet: true, wallet_kind: walletKind },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },

    onSuccess: async (data) => {
      toast.success(`Spend cap updated: $${Number(data.old_spend_cap).toLocaleString()} → $${Number(data.new_spend_cap).toLocaleString()}`);
      const topUpAccId = topUpAccount.id;
      setTopUpAccount(null);
      setTopUpAmount("");
      queryClient.invalidateQueries({ queryKey: ["client-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["client-wallet"] });
      queryClient.invalidateQueries({ queryKey: ["dual-wallets"] });
      queryClient.invalidateQueries({ queryKey: ["client-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["client-dashboard-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["client-dashboard-ad-accounts"] });
      // Post-topup: immediately sync just this 1 account from Meta (no cooldown)
      try {
        const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
        const result = await chunkedMetaSync([topUpAccId]);
        if (result?.insights) {
          refetchInsights();
          queryClient.invalidateQueries({ queryKey: ["client-all-insights"] });
        }
      } catch (e) { console.error("Post-topup sync failed:", e); }
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
  });


  const lastUpdated = useMemo(() => {
    const times = Object.values(insights).map((i: any) => i.updated_at).filter(Boolean);
    if (times.length === 0) return null;
    // Use the LATEST sync time, not the oldest — otherwise a single never-refreshed
    // account would drag the label back in time even when most accounts updated recently.
    return new Date(Math.max(...times.map((t: string) => new Date(t).getTime())));
  }, [insights]);

  const aggregatedTodaySpend = Object.values(insights).reduce((sum: number, i: any) => sum + Number(i.today_spend ?? 0), 0);
  const aggregatedYesterdaySpend = Object.values(insights).reduce((sum: number, i: any) => sum + Number(i.yesterday_spend ?? 0), 0);
  const aggregatedTodayOrders = Object.values(insights).reduce((sum: number, i: any) => sum + Number(i.today_orders ?? 0), 0);
  const aggregatedYesterdayOrders = Object.values(insights).reduce((sum: number, i: any) => sum + Number(i.yesterday_orders ?? 0), 0);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Wallet Hero + Metrics */}
      <div className="space-y-3">
        {/* Wallet Balance Hero Card */}
        <div className="rounded-2xl bg-gradient-to-br from-primary via-primary/85 to-primary/65 p-5 text-primary-foreground shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-90">Wallet Balance</p>
              <p className="text-3xl font-bold tracking-tight mt-1">${walletBalance.toLocaleString()}</p>
              {dueLimit > 0 && <p className="text-xs opacity-70 mt-1">Due limit: ${dueLimit.toLocaleString()}</p>}
            </div>
            <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
              <Wallet className="h-6 w-6" />
            </div>
          </div>
        </div>
        {/* Secondary wallet — shown for clients who have it enabled (mobile + desktop) */}
        {wallets.secondaryEnabled && (
          <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-green-700 dark:text-green-400">Secondary Wallet</p>
                <p className="text-2xl font-bold tracking-tight mt-1 text-green-700 dark:text-green-300">
                  ${Number(wallets.secondaryBalance ?? 0).toLocaleString()}
                </p>
                <p className="text-[11px] text-green-700/70 dark:text-green-400/70 mt-0.5">
                  Rate ৳{wallets.secondaryRate}/USD
                  {secondaryDueLimit > 0 && ` · Due limit: $${secondaryDueLimit.toLocaleString()}`}
                </p>
              </div>
              <div className="h-10 w-10 rounded-full bg-green-500/15 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
            </div>
          </div>
        )}
        {/* Spend & Orders */}
        <div className="grid gap-3 grid-cols-2">
          <MetricCard
            title="Today's Spend"
            value={`$${aggregatedTodaySpend.toLocaleString()}`}
            subtitle={`Yesterday: $${aggregatedYesterdaySpend.toLocaleString()}`}
            icon={DollarSign}
            iconBg="bg-emerald-50 dark:bg-emerald-900/30"
            iconColor="text-emerald-600"
            size={isMobile ? "sm" : "default"}
          />
          <MetricCard
            title="Today's Orders"
            value={aggregatedTodayOrders.toLocaleString()}
            subtitle={`Yesterday: ${aggregatedYesterdayOrders.toLocaleString()}`}
            icon={ShoppingCart}
            iconBg="bg-blue-50 dark:bg-blue-900/30"
            iconColor="text-blue-600"
            size={isMobile ? "sm" : "default"}
          />
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl md:text-2xl font-bold">Ad Accounts</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {isAutoSyncing && (
            <span className="text-xs text-primary flex items-center gap-1">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Syncing from Meta...
            </span>
          )}
          {lastUpdated && !isMobile && !isAutoSyncing && (
            <span className="text-xs text-muted-foreground">
              Last synced: {lastUpdated.toLocaleString()}
            </span>
          )}
          {showSelect && selectedIds.size > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={() => refreshSelectedMutation.mutate()}
              disabled={refreshSelectedMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${refreshSelectedMutation.isPending ? 'animate-spin' : ''}`} />
              {refreshSelectedMutation.isPending ? "..." : `Update ${selectedIds.size}`}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshAllMutation.mutate()}
            disabled={refreshAllMutation.isPending}
            className="text-xs"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshAllMutation.isPending ? 'animate-spin' : ''}`} />
            {refreshAllMutation.isPending ? "Updating..." : isMobile ? "Update All" : "Update All from Meta"}
          </Button>
        </div>
      </div>
      {lastSyncCalls !== null && (
        <div className="text-xs text-muted-foreground -mt-2">
          Last sync used <span className="font-semibold text-foreground">{lastSyncCalls}</span> Meta API call{lastSyncCalls === 1 ? "" : "s"}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 rounded-full"
          />
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
          </SelectContent>
        </Select>
        {!isMobile ? (
          <Select value={cardFilter} onValueChange={setCardFilter}>
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
        ) : (
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
        <Button
          variant={showSelect ? "secondary" : "ghost"}
          size="icon"
          className="h-9 w-9"
          onClick={() => {
            setShowSelect((v) => !v);
            if (showSelect) setSelectedIds(new Set());
          }}
          title="Toggle selection"
        >
          <ListChecks className="h-4 w-4" />
        </Button>
      </div>

      {isInactive && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="p-3 flex items-center gap-2">
            <span className="text-destructive font-semibold text-sm">⚠️ Account frozen. Top up disabled.</span>
          </CardContent>
        </Card>
      )}

      {/* Mobile Card Layout */}
      {isMobile ? (
         <div className="space-y-3">
          {paginatedAccounts.map((a: any, idx: number) => {
            const ins = insights[a.id];
            return (
              <Card
                key={a.id}
                className="border border-border/60 shadow-sm cursor-pointer active:scale-[0.98] transition-transform"
                onClick={() => navigate(`/ad-accounts/${a.id}`)}
                data-state={selectedIds.has(a.id) ? "selected" : undefined}
                data-tutorial={idx === 0 ? "ad-account-card" : undefined}
              >
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    {showSelect && (
                      <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(a.id)}
                          onCheckedChange={() => toggleSelect(a.id)}
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      {/* Top row: name + status */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{a.account_name}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[11px] text-muted-foreground font-mono">{a?.account_id?.replace(/^act_/, '')}</span>
                            <a
                              href={a?.platform === 'tiktok' ? `https://ads.tiktok.com/i18n/dashboard?aadvid=${a?.account_id?.replace(/^act_/, '')}` : `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${a?.account_id?.replace(/^act_/, '')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-primary"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <StatusBadge status={a.status} />
                          <InactiveBadge lastSpendDate={(ins as any)?.last_spend_date} fallbackDate={a.created_at} />
                          <HoldBadge accountId={a.id} compact />
                        </div>
                      </div>

                      {/* Spend progress */}
                      <div className="mt-2" onClick={(e) => e.stopPropagation()} data-tutorial={idx === 0 ? "ad-account-remaining" : undefined}>
                        <SpendProgressBar amountSpent={Number(a.amount_spent)} spendCap={Number(a.spend_cap)} balanceAfterTopup={Number((a as any).balance_after_topup ?? 0)} />
                      </div>

                      {limitWatches[a.id] && (
                        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                          <LimitUpdateIndicator state={limitWatches[a.id]} />
                        </div>
                      )}



                      {/* Insights row */}
                      {ins && (
                        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                          <div className="bg-muted/50 rounded-md p-1.5">
                            <p className="text-[10px] text-muted-foreground">Today Spend</p>
                            <p className="text-xs font-semibold">${Number(ins.today_spend ?? 0).toLocaleString()}</p>
                          </div>
                          <div className="bg-muted/50 rounded-md p-1.5">
                            <p className="text-[10px] text-muted-foreground">Orders</p>
                            <p className="text-xs font-semibold">{Number(ins.today_orders ?? 0)}</p>
                          </div>
                          <div className="bg-muted/50 rounded-md p-1.5">
                            <p className="text-[10px] text-muted-foreground">Balance</p>
                            <p className="text-xs font-semibold">${Number(ins.balance ?? 0).toLocaleString()}</p>
                          </div>
                        </div>
                      )}

                      {/* Last Refreshed */}
                      {ins?.updated_at && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Last Refreshed: {formatDistanceToNow(new Date(ins.updated_at), { addSuffix: true })}
                        </p>
                      )}

                      {/* Top Up + Actions */}
                      <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                        {a.client_topup_disabled ? (
                          <Button size="sm" variant="outline" className="flex-1 text-xs h-8" disabled>
                            Admin Top-Up Only
                          </Button>
                        ) : a.external_topup_required ? (
                          <>
                            {a.external_topup_url && (
                              <Button
                                size="sm"
                                className="flex-1 bg-gradient-to-r from-primary to-primary/75 hover:from-primary/90 hover:to-primary/70 text-primary-foreground text-xs h-8 shadow-md shadow-primary/25"
                                disabled={isInactive}
                                onClick={() => { setTopUpAccount(a); setTopUpWallet("primary"); setTopUpAmount(""); }}
                                data-tutorial={idx === 0 ? "ad-account-topup-btn" : undefined}
                              >
                                <ArrowUpCircle className="h-3.5 w-3.5 mr-1" />
                                Top Up
                              </Button>
                            )}
                            {a.external_topup_url_secondary && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="flex-1 text-xs h-8"
                                disabled={isInactive}
                                onClick={() => { setTopUpAccount(a); setTopUpWallet("secondary"); setTopUpAmount(""); }}
                              >
                                <ArrowUpCircle className="h-3.5 w-3.5 mr-1" />
                                Secondary Top Up
                              </Button>
                            )}
                            {a.external_topup_url_credit_line && (
                              <Button
                                size="sm"
                                className="flex-1 text-xs h-8 bg-sky-600 hover:bg-sky-700 text-white"
                                disabled={isInactive}
                                onClick={() => { setTopUpAccount(a); setTopUpWallet("credit_line"); setTopUpAmount(""); }}
                              >
                                <ArrowUpCircle className="h-3.5 w-3.5 mr-1" />
                                Credit Line Top Up
                              </Button>
                            )}
                            {!a.external_topup_url && !a.external_topup_url_secondary && !a.external_topup_url_credit_line && (
                              <Button size="sm" variant="outline" className="flex-1 text-xs h-8" disabled>
                                Admin Top-Up Only
                              </Button>
                            )}
                          </>
                        ) : (
                          <Button
                            size="sm"
                            className="flex-1 bg-gradient-to-r from-primary to-primary/75 hover:from-primary/90 hover:to-primary/70 text-primary-foreground text-xs h-8 shadow-md shadow-primary/25"
                            disabled={isInactive}
                            onClick={() => { setTopUpAccount(a); setTopUpWallet("primary"); setTopUpAmount(""); }}
                            data-tutorial={idx === 0 ? "ad-account-topup-btn" : undefined}
                          >
                            <ArrowUpCircle className="h-3.5 w-3.5 mr-1" />
                            Top Up
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" data-tutorial={idx === 0 ? "ad-account-3dot" : undefined}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canRename && (
                              <DropdownMenuItem data-tutorial={idx === 0 ? "ad-account-rename" : undefined} onClick={() => { setRenameAccount(a); setRenameName(a.account_name); }}>
                                <Pencil className="h-3.5 w-3.5 mr-2" />
                                Rename
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => { setBmReqAccount(a); setBmReqForm({ bm_name: "", bm_id: "" }); }}>
                              Request BM Access
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openWithdraw(a)}>
                              <ArrowDownCircle className="h-3.5 w-3.5 mr-2" />
                              {canWithdraw ? "Withdraw to Wallet" : "Request Spend Cap Withdraw"}
                            </DropdownMenuItem>
                            {hasAutoTopupPermission && (
                              <DropdownMenuItem onClick={() => {
                                setAutoTopupAccount(a);
                                const rule = autoTopupRulesMap[a.id];
                                setAutoTopupThreshold(rule ? String(rule.threshold_balance) : "");
                                setAutoTopupAmount(rule ? String(rule.topup_amount) : "");
                              }}>
                                <Zap className="h-3.5 w-3.5 mr-2" />
                                Auto Top-Up
                                {autoTopupRulesMap[a.id]?.is_active && <span className="ml-1 text-emerald-500">●</span>}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {(!accounts || accounts.length === 0) && (
            <p className="text-center text-muted-foreground py-8 text-sm">No ad accounts assigned to you yet</p>
          )}
          {accounts && accounts.length > 0 && paginatedAccounts.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">No accounts match your filters</p>
          )}
        </div>
      ) : (
        /* Desktop Table Layout */
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
                  <TableHead className="w-[90px]">
                    <span className="text-xs font-medium">Status</span>
                  </TableHead>
                  <TableHead className="w-[120px]">
                    <span className="text-xs font-medium">Last Refreshed</span>
                  </TableHead>
                  <TableHead className="w-[50px]">
                    <span className="text-xs font-medium">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedAccounts.map((a: any, idx: number) => {
                  const ins = insights[a.id];
                  return (
                    <TableRow
                      key={a.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/ad-accounts/${a.id}`)}
                      data-state={selectedIds.has(a.id) ? "selected" : undefined}
                    >
                      {showSelect && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(a.id)}
                            onCheckedChange={() => toggleSelect(a.id)}
                            aria-label={`Select ${a.account_name}`}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                            <AppWindow className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <div className="text-sm text-primary">{a.account_name}</div>
                            {a.business_managers?.name && (
                              <div className="text-xs text-muted-foreground">{a.business_managers.name}</div>
                            )}
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground font-mono">{a?.account_id?.replace(/^act_/, '')}</span>
                              <a
                                href={a?.platform === 'tiktok' ? `https://ads.tiktok.com/i18n/dashboard?aadvid=${a?.account_id?.replace(/^act_/, '')}` : `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${a?.account_id?.replace(/^act_/, '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-primary"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                            <div className="mt-1">
                              <InactiveBadge lastSpendDate={(ins as any)?.last_spend_date} fallbackDate={a.created_at} />
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <SpendProgressBar amountSpent={Number(a.amount_spent)} spendCap={Number(a.spend_cap)} balanceAfterTopup={Number((a as any).balance_after_topup ?? 0)} />
                      </TableCell>
                      <TableCell><div className="flex flex-col gap-1"><StatusBadge status={a.status} /><HoldBadge accountId={a.id} compact /></div></TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {ins?.updated_at ? formatDistanceToNow(new Date(ins.updated_at), { addSuffix: true }) : "—"}
                        </span>
                        {limitWatches[a.id] && (
                          <div className="mt-1 max-w-[130px]">
                            <LimitUpdateIndicator state={limitWatches[a.id]} />
                          </div>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {a.client_topup_disabled ? (
                            <Button size="sm" variant="outline" disabled title="Admin top-up only">
                              <LockIcon className="h-4 w-4 mr-1" />
                              Admin Only
                            </Button>
                          ) : a.external_topup_required ? (
                            <>
                              {a.external_topup_url && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="bg-gradient-to-r from-primary to-primary/75 hover:from-primary/90 hover:to-primary/70 text-primary-foreground shadow-md shadow-primary/25"
                                  disabled={isInactive}
                                  title="Request top-up (Main wallet)"
                                  onClick={() => { setTopUpAccount(a); setTopUpWallet("primary"); setTopUpAmount(""); }}
                                >
                                  <ArrowUpCircle className="h-4 w-4" />
                                  Top Up
                                </Button>
                              )}
                              {a.external_topup_url_secondary && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={isInactive}
                                  title="Request top-up (Secondary wallet)"
                                  onClick={() => { setTopUpAccount(a); setTopUpWallet("secondary"); setTopUpAmount(""); }}
                                >
                                  <ArrowUpCircle className="h-4 w-4" />
                                  Secondary
                                </Button>
                              )}
                              {a.external_topup_url_credit_line && (
                                <Button
                                  size="sm"
                                  className="bg-sky-600 hover:bg-sky-700 text-white"
                                  disabled={isInactive}
                                  title="Request top-up (Credit line wallet)"
                                  onClick={() => { setTopUpAccount(a); setTopUpWallet("credit_line"); setTopUpAmount(""); }}
                                >
                                  <ArrowUpCircle className="h-4 w-4" />
                                  Credit Line
                                </Button>
                              )}
                              {!a.external_topup_url && !a.external_topup_url_secondary && !a.external_topup_url_credit_line && (
                                <Button size="sm" variant="outline" disabled title="Admin top-up only">
                                  <LockIcon className="h-4 w-4 mr-1" />
                                  Admin Only
                                </Button>
                              )}
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="default"
                              className="bg-gradient-to-r from-primary to-primary/75 hover:from-primary/90 hover:to-primary/70 text-primary-foreground shadow-md shadow-primary/25"
                              disabled={isInactive}
                              onClick={() => { setTopUpAccount(a); setTopUpWallet("primary"); setTopUpAmount(""); }}
                            >
                              <ArrowUpCircle className="h-4 w-4" />
                              Top Up
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" data-tutorial={idx === 0 ? "ad-account-3dot" : undefined}>
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canRename && (
                                <DropdownMenuItem data-tutorial={idx === 0 ? "ad-account-rename" : undefined} onClick={() => { setRenameAccount(a); setRenameName(a.account_name); }}>
                                  <Pencil className="h-3.5 w-3.5 mr-2" />
                                  Rename
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => { setBmReqAccount(a); setBmReqForm({ bm_name: "", bm_id: "" }); }}>
                                Request BM Access
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openWithdraw(a)}>
                                <ArrowDownCircle className="h-3.5 w-3.5 mr-2" />
                                {canWithdraw ? "Withdraw to Wallet" : "Request Spend Cap Withdraw"}
                              </DropdownMenuItem>
                              {hasAutoTopupPermission && (
                                <DropdownMenuItem onClick={() => {
                                  setAutoTopupAccount(a);
                                  const rule = autoTopupRulesMap[a.id];
                                  setAutoTopupThreshold(rule ? String(rule.threshold_balance) : "");
                                  setAutoTopupAmount(rule ? String(rule.topup_amount) : "");
                                }}>
                                  <Zap className="h-3.5 w-3.5 mr-2" />
                                  Auto Top-Up
                                  {autoTopupRulesMap[a.id]?.is_active && <span className="ml-1 text-emerald-500">●</span>}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!accounts || accounts.length === 0) && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No ad accounts assigned to you yet</TableCell></TableRow>
                )}
                {accounts && accounts.length > 0 && paginatedAccounts.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No accounts match your filters</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            {((safePage - 1) * PAGE_SIZE) + 1}–{Math.min(safePage * PAGE_SIZE, sortedAccounts.length)} of {sortedAccounts.length}
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

      {/* Failed Top-Ups */}
      <FailedTopUps />

      {/* Top Up Dialog */}
      <Dialog open={!!topUpAccount} onOpenChange={(open) => !open && setTopUpAccount(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isExternalTopUp ? "Request Top-Up" : "Increase Spend Limit"}</DialogTitle>
            <DialogDescription>
              Top up <span className="font-semibold">{topUpAccount?.account_name}</span> ({topUpAccount?.account_id?.replace(/^act_/, '')})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex justify-between items-center text-sm p-3 rounded-lg bg-muted">
              <span className="flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                {topUpWallet === "secondary" ? "Secondary Wallet" : topUpWallet === "credit_line" ? "Credit Line Wallet" : "Main Wallet"}
              </span>
              <span className={`font-semibold ${activeWalletBalance < 0 ? 'text-destructive' : ''}`}>
                ${activeWalletBalance.toLocaleString()}
              </span>
            </div>
            {isAltTopUp && (
              <div className="flex justify-between items-center text-sm p-3 rounded-lg bg-muted/60">
                <span className="text-muted-foreground">Main Wallet (usable here)</span>
                <span className="font-medium">
                  ${walletBalance.toLocaleString()}
                  {mainToSecondaryFactor !== 1 && (
                    <span className="text-muted-foreground"> ≈ ${(walletBalance * mainToSecondaryFactor).toFixed(2)}</span>
                  )}
                </span>
              </div>
            )}
            {activeDueLimit > 0 && (
              <div className="flex justify-between items-center text-sm p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <span className="text-amber-700 dark:text-amber-400">
                  {isCreditLineTopUp ? "Credit Line Due Limit" : isSecondaryTopUp ? "Secondary Due Limit" : "Due Limit"}
                </span>
                <span className="font-semibold text-amber-700 dark:text-amber-400">${activeDueLimit.toLocaleString()}</span>
              </div>
            )}
            {!isExternalTopUp && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Current Spend Cap</span>
                <span className="font-medium">${Number(topUpAccount?.spend_cap ?? 0).toLocaleString()}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label>Amount to Add (USD)</Label>
              <Input
                type="number"
                min="1"
                step="0.01"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                placeholder="500.00"
              />
              {exceedsBalance && parsedAmount > 0 && (
                <p className="text-sm text-destructive">Insufficient fund — amount exceeds your wallet balance{activeDueLimit > 0 ? " + due limit" : ""}</p>
              )}
              {isAltTopUp && !exceedsBalance && convertFromMain > 0.009 && parsedAmount > 0 && (
                <p className="text-sm text-blue-600">
                  ${convertFromMain.toFixed(2)} will be moved from your Main Wallet
                  {mainRate > 0 && altRate > 0 && mainRate !== altRate && ` (rate ${mainRate} → ${altRate})`}
                </p>
              )}
              {usingDueLimit && parsedAmount > 0 && (
                <p className="text-sm text-amber-600">
                  ⚠️ Using ${(isAltTopUp ? secondaryDueUsed : parsedAmount - activeWalletBalance).toFixed(2)} from
                  {isCreditLineTopUp ? " credit line" : isSecondaryTopUp ? " secondary" : ""} due limit
                </p>
              )}
            </div>



            {!isExternalTopUp && parsedAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">New Spend Cap</span>
                <span className="font-medium text-primary">
                  ${(Number(topUpAccount?.spend_cap ?? 0) + parsedAmount).toLocaleString()}
                </span>
              </div>
            )}

            {isExternalTopUp && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs space-y-1">
                <p className="font-semibold text-amber-700 dark:text-amber-300">How this works:</p>
                <ol className="list-decimal ml-4 text-amber-700 dark:text-amber-300/90 space-y-0.5">
                  <li>Amount is deducted from your {topUpWallet === "secondary" ? "secondary" : topUpWallet === "credit_line" ? "credit line" : "main"} wallet right away.</li>
                  <li>Our team gets the request instantly and tops up your ad account.</li>
                  <li>If it can't be processed, the amount is refunded automatically.</li>
                </ol>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopUpAccount(null)}>Cancel</Button>
            {isExternalTopUp ? (
              <Button
                onClick={() => externalRequestMutation.mutate(topUpWallet)}
                disabled={!topUpAmount || parsedAmount <= 0 || exceedsBalance || externalRequestMutation.isPending || externalCooldownLeft > 0}
              >
                {externalRequestMutation.isPending
                  ? "Submitting..."
                  : externalCooldownLeft > 0
                    ? `Wait ${externalCooldownLeft}s...`
                    : "Send Top-Up Request"}
              </Button>
            ) : (
              <Button
                onClick={() => topUpMutation.mutate("primary")}
                disabled={!topUpAmount || parsedAmount <= 0 || exceedsBalance || topUpMutation.isPending}
              >
                {topUpMutation.isPending ? "Processing..." : "Top Up Now"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* BM Access Request Dialog */}
      <Dialog open={!!bmReqAccount} onOpenChange={(open) => { if (!open) setBmReqAccount(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request BM Access</DialogTitle>
            <DialogDescription>
              Request Business Manager partner access for <span className="font-medium text-foreground">{bmReqAccount?.account_name}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>BM Name *</Label>
              <Input
                value={bmReqForm.bm_name}
                onChange={(e) => setBmReqForm(f => ({ ...f, bm_name: e.target.value }))}
                placeholder="Business Manager name"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>BM ID *</Label>
              <Input
                value={bmReqForm.bm_id}
                onChange={(e) => setBmReqForm(f => ({ ...f, bm_id: e.target.value }))}
                placeholder="e.g. 123456789"
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBmReqAccount(null)}>Cancel</Button>
            <Button onClick={handleBmReqSubmit} disabled={bmReqLoading || !bmReqForm.bm_name || !bmReqForm.bm_id}>
              {bmReqLoading ? "Submitting..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Spend Cap Withdraw Request Dialog */}
      <Dialog open={!!withdrawAccount} onOpenChange={(open) => { if (!open) setWithdrawAccount(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{canWithdraw ? "Withdraw to Wallet" : "Request Spend Cap Withdraw"}</DialogTitle>
            <DialogDescription>
              {canWithdraw ? (
                <>
                  Move unused balance from{" "}
                  <span className="font-medium text-foreground">{withdrawAccount?.account_name}</span> back into your
                  wallet. Only the amount Meta still allows can be withdrawn.
                </>
              ) : (
                <>
                  Request a spend cap reduction for{" "}
                  <span className="font-medium text-foreground">{withdrawAccount?.account_name}</span>. Support will
                  review and process it manually.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {canWithdraw && (
              <div className="flex items-center justify-between rounded-lg bg-muted p-3 text-sm">
                <span className="text-muted-foreground">Max withdrawable (live from Meta)</span>
                <span className="font-semibold">
                  {withdrawMaxLoading
                    ? "Checking…"
                    : withdrawMax != null
                      ? `$${withdrawMax.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                      : "—"}
                </span>
              </div>
            )}
            <div>
              <Label>Amount (USD) *</Label>
              <Input
                type="number"
                min="1"
                step="0.01"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="e.g. 100"
                className="mt-1.5"
              />
              {canWithdraw && withdrawMax != null && parseFloat(withdrawAmount || "0") > withdrawMax && (
                <p className="mt-1.5 text-sm text-destructive">
                  Max withdrawable is ${withdrawMax.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
              )}
            </div>
            {!canWithdraw && (
              <div>
                <Label>Note (optional)</Label>
                <Input
                  value={withdrawNote}
                  onChange={(e) => setWithdrawNote(e.target.value)}
                  placeholder="Reason or instructions"
                  className="mt-1.5"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawAccount(null)}>Cancel</Button>
            <Button
              onClick={handleWithdrawSubmit}
              disabled={
                withdrawLoading ||
                !withdrawAmount ||
                (canWithdraw && (withdrawMaxLoading || (withdrawMax != null && parseFloat(withdrawAmount || "0") > withdrawMax)))
              }
            >
              {withdrawLoading ? "Processing..." : canWithdraw ? "Withdraw Now" : "Submit Request"}
            </Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>
      {/* Rename Dialog */}
      <Dialog open={!!renameAccount} onOpenChange={(open) => { if (!open) setRenameAccount(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Ad Account</DialogTitle>
            <DialogDescription>
              Rename <span className="font-medium text-foreground">{renameAccount?.account_name}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>New Name *</Label>
              <Input
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder="Enter new account name"
                className="mt-1.5"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameAccount(null)}>Cancel</Button>
            <Button onClick={() => renameMutation.mutate()} disabled={renameMutation.isPending || !renameName.trim()}>
              {renameMutation.isPending ? "Renaming..." : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Auto Top-Up Dialog */}
      <Dialog open={!!autoTopupAccount} onOpenChange={(open) => { if (!open) setAutoTopupAccount(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              Auto Top-Up
            </DialogTitle>
            <DialogDescription>
              Configure automatic spend limit increase for <span className="font-medium text-foreground">{autoTopupAccount?.account_name}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {autoTopupRulesMap[autoTopupAccount?.id]?.is_active && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
                <Zap className="h-4 w-4 text-emerald-600" />
                <span className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">Active</span>
              </div>
            )}
            <div>
              <Label>Trigger when balance drops to (USD)</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={autoTopupThreshold}
                onChange={(e) => setAutoTopupThreshold(e.target.value)}
                placeholder="e.g. 50"
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1">When account balance ≤ this amount, auto top-up triggers</p>
            </div>
            <div>
              <Label>Top-up amount (USD)</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={autoTopupAmount}
                onChange={(e) => setAutoTopupAmount(e.target.value)}
                placeholder="e.g. 500"
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1">Amount to add from your wallet automatically</p>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {autoTopupRulesMap[autoTopupAccount?.id] && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteAutoTopupMutation.mutate(autoTopupRulesMap[autoTopupAccount.id].id)}
                disabled={deleteAutoTopupMutation.isPending}
                className="mr-auto"
              >
                {deleteAutoTopupMutation.isPending ? "Removing..." : "Remove Rule"}
              </Button>
            )}
            <Button variant="outline" onClick={() => setAutoTopupAccount(null)}>Cancel</Button>
            <Button
              onClick={() => {
                const threshold = parseFloat(autoTopupThreshold);
                const amount = parseFloat(autoTopupAmount);
                if (isNaN(threshold) || threshold < 0) { toast.error("Enter a valid threshold"); return; }
                if (isNaN(amount) || amount <= 0) { toast.error("Enter a valid amount"); return; }
                saveAutoTopupMutation.mutate({
                  accountId: autoTopupAccount.id,
                  threshold,
                  amount,
                  isActive: true,
                });
              }}
              disabled={saveAutoTopupMutation.isPending || !autoTopupThreshold || !autoTopupAmount}
            >
              {saveAutoTopupMutation.isPending ? "Saving..." : autoTopupRulesMap[autoTopupAccount?.id] ? "Update Rule" : "Enable Auto Top-Up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
