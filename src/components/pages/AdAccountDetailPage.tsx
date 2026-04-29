import { useState, useMemo } from "react";
import { useParams, useNavigate } from "@/lib/router-compat";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { SpendProgressBar } from "@/components/SpendProgressBar";
import { MetricCard } from "@/components/MetricCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Pencil, Check, X, ExternalLink, User, RefreshCw, Megaphone, DollarSign, ShoppingCart, MessageSquare, ChevronsUpDown, ArrowUpCircle, AlertTriangle, Settings, History, ChevronDown, ChevronUp, Gauge, Globe } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCampaignManagementAccess } from "@/hooks/useCampaignManagementAccess";
import { AdAccountPartners } from "@/components/admin/AdAccountPartners";
import { AdAccountPaymentMethods } from "@/components/admin/AdAccountPaymentMethods";
import { CardHistoryTimeline } from "@/components/admin/CardHistoryTimeline";
import { HackRecoveryPanel } from "@/components/admin/HackRecoveryPanel";
import { SilentRecoveryDialog } from "@/components/admin/SilentRecoveryDialog";
import { ExternalTopUpConfigSection } from "@/components/admin/ExternalTopUpConfigSection";
import { ExternalTopUpDialog } from "@/components/admin/ExternalTopUpDialog";
import { friendlyEdgeError } from "@/lib/utils";
import { InactiveBadge } from "@/components/InactiveBadge";
import { AdminNotes } from "@/components/admin/AdminNotes";

export default function AdAccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { allowed: canManageCampaigns } = useCampaignManagementAccess();

  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [updatingMeta, setUpdatingMeta] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [lastMetaUpdate, setLastMetaUpdate] = useState<number>(0);
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [showUpdateCap, setShowUpdateCap] = useState(false);
  const [newSpendCap, setNewSpendCap] = useState("");
  const [showLimitHistory, setShowLimitHistory] = useState(false);
  const [showExternalTopUp, setShowExternalTopUp] = useState(false);
  const [showSilentRecovery, setShowSilentRecovery] = useState(false);

  // Daily Spending Limit (on-demand, button-triggered Meta call via proxy)
  const [limitData, setLimitData] = useState<{
    daily_spend_limit: number;
    currency: string;
    fetched_at: string;
    via?: string;
    ip?: string | null;
  } | null>(null);
  const [limitLoading, setLimitLoading] = useState(false);

  const fetchLimits = async () => {
    if (!id) return;
    setLimitLoading(true);
    try {
      // Direct fetch so we can read the JSON error body even on non-2xx.
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-ad-account-limits`;
      const res = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ ad_account_id: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      setLimitData({
        daily_spend_limit: data.data.daily_spend_limit ?? 0,
        currency: data.data.currency || "USD",
        fetched_at: data.data.fetched_at,
        via: data.meta?.via,
        ip: data.meta?.ip ?? null,
      });
      toast.success("Daily limit refreshed from Meta");
    } catch (err: any) {
      const msg = err?.message || String(err ?? "");
      toast.error(msg || "Failed to fetch daily limit");
    } finally {
      setLimitLoading(false);
    }
  };

  const { data: account, isLoading } = useQuery({
    queryKey: ["ad-account-detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_accounts")
        .select("*, business_managers(name, bm_id)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  const isTikTok = account?.platform === "tiktok";

  // Meta insights via edge function — gracefully return null on failure so the page still renders
  const { data: metaInsights, refetch: refetchInsights, isError: insightsError } = useQuery({
    queryKey: ["ad-account-insights-detail", id],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.functions.invoke("get-account-insights", {
          body: { ad_account_ids: [id], source: "cache" },
        });
        if (error) {
          console.warn("Insights fetch failed:", error);
          return null;
        }
        return data?.insights?.[id!] ?? null;
      } catch (err) {
        console.warn("Insights fetch threw:", err);
        return null;
      }
    },
    enabled: !!id && !isTikTok,
    retry: 1,
  });

  // TikTok insights from DB
  const { data: tiktokInsights } = useQuery({
    queryKey: ["tiktok-account-insights-detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_account_insights")
        .select("*")
        .eq("ad_account_id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id && isTikTok,
  });

  const insights = isTikTok ? tiktokInsights : metaInsights;

  const { data: assignments } = useQuery({
    queryKey: ["ad-account-assignments", id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("user_ad_accounts")
        .select("*")
        .eq("ad_account_id", id!);
      return (data as any[]) ?? [];
    },
    enabled: !!id && isAdmin,
  });

  const { data: clients } = useQuery({
    queryKey: ["admin-clients-list"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email");
      return (data as any[]) ?? [];
    },
    enabled: isAdmin,
  });

  const assignedUserId = assignments?.[0]?.user_id ?? null;

  // Spending limit history from system_logs
  const { data: limitHistory } = useQuery({
    queryKey: ["spending-limit-history", id, account?.account_id],
    queryFn: async () => {
      const actId = account?.account_id;
      if (!actId) return [];
      // Query system_logs for spend cap updates matching this account
      const { data, error } = await supabase
        .from("system_logs")
        .select("details, created_at, user_name")
        .in("action", ["Spend Cap Updated", "TikTok Spend Cap Updated"])
        .like("details", `%${actId.replace(/^act_/, "")}%`)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((row: any) => {
        const match = row.details?.match(/\$([0-9,.]+)\s*→\s*\$([0-9,.]+)/);
        const oldCap = match ? parseFloat(match[1].replace(/,/g, "")) : 0;
        const newCap = match ? parseFloat(match[2].replace(/,/g, "")) : 0;
        const added = newCap - oldCap;
        return {
          date: row.created_at,
          oldCap,
          newCap,
          added,
          updatedBy: row.user_name || "System",
        };
      });
    },
    enabled: !!id && !!account?.account_id,
  });

  const assignMutation = useMutation({
    mutationFn: async (userId: string | null) => {
      await (supabase as any).from("user_ad_accounts").delete().eq("ad_account_id", id!);
      if (userId) {
        const { error } = await (supabase as any).from("user_ad_accounts").insert({
          user_id: userId,
          ad_account_id: id!,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Assignment updated");
      queryClient.invalidateQueries({ queryKey: ["ad-account-assignments", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-user-ad-accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Rename - Meta uses edge function, TikTok just updates DB
  const renameMutation = useMutation({
    mutationFn: async () => {
      if (isTikTok) {
        // TikTok: just update DB name
        const { error } = await supabase
          .from("ad_accounts")
          .update({ account_name: newName.trim() })
          .eq("id", id!);
        if (error) throw error;
        return { old_name: account.account_name, new_name: newName.trim() };
      } else {
        // Meta: use edge function to rename via API
        const { data, error } = await supabase.functions.invoke("rename-ad-account", {
          body: { ad_account_id: id, new_name: newName },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return data;
      }
    },
    onSuccess: (data) => {
      toast.success(`Renamed: ${data.old_name} → ${data.new_name}`);
      setIsRenaming(false);
      queryClient.invalidateQueries({ queryKey: ["ad-account-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["tiktok-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["client-ad-accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Top-up mutation
  const topUpMutation = useMutation({
    mutationFn: async () => {
      if (!topUpAmount) throw new Error("Enter amount");
      const amt = parseFloat(topUpAmount);
      if (isNaN(amt) || amt <= 0) throw new Error("Invalid amount");

      const edgeFn = isTikTok ? "tiktok-topup" : "spend-cap-update";
      const body = isTikTok
        ? { ad_account_id: id, amount: amt, deduct_wallet: !!assignedUserId, target_user_id: assignedUserId }
        : { ad_account_id: id, amount: amt, deduct_wallet: !!assignedUserId, target_user_id: assignedUserId };

      const { data, error } = await supabase.functions.invoke(edgeFn, { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success(`Top up successful: $${topUpAmount}`);
      setShowTopUp(false);
      setTopUpAmount("");
      queryClient.invalidateQueries({ queryKey: ["ad-account-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["tiktok-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-wallets"] });
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
  });

  // Update spend cap mutation
  const updateCapMutation = useMutation({
    mutationFn: async () => {
      if (!newSpendCap) throw new Error("Enter spend cap");
      const cap = parseFloat(newSpendCap);
      if (isNaN(cap) || cap < 0) throw new Error("Invalid spend cap");
      const { error } = await supabase.from("ad_accounts").update({ spend_cap: cap, fraud_flag: false } as any).eq("id", id!);
      if (error) throw error;
      return cap;
    },
    onSuccess: (cap) => {
      const bmId = account?.business_managers?.bm_id;
      const billingUrl = bmId
        ? `https://business.tiktok.com/manage/payment/v2?org_id=${bmId}&aadvid=${account?.account_id}`
        : `https://ads.tiktok.com/i18n/account/payment?aadvid=${account?.account_id}`;
      window.open(billingUrl, "_blank");
      toast.success(`Spend cap set to $${cap.toLocaleString()}`);
      setShowUpdateCap(false);
      setNewSpendCap("");
      queryClient.invalidateQueries({ queryKey: ["ad-account-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["tiktok-ad-accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });
  const handleUpdateFromSource = async () => {
    if (!isAdmin && !isTikTok) {
      const now = Date.now();
      const elapsed = now - lastMetaUpdate;
      const cooldown = 15 * 60 * 1000;
      if (elapsed < cooldown) {
        const remainingMin = Math.ceil((cooldown - elapsed) / 60000);
        toast.error(`Please wait ${remainingMin} minute(s) before updating again.`);
        return;
      }
    }

    setUpdatingMeta(true);
    try {
      if (isTikTok) {
        // Re-sync from TikTok BC
        if (account.business_manager_id) {
          const { data, error } = await supabase.functions.invoke("tiktok-sync", {
            body: { business_manager_id: account.business_manager_id },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          await queryClient.invalidateQueries({ queryKey: ["ad-account-detail", id] });
          await queryClient.invalidateQueries({ queryKey: ["tiktok-account-insights-detail", id] });
          toast.success("Data updated from TikTok BC");
        } else {
          toast.error("No Business Center linked to this account");
        }
      } else {
        const { error } = await supabase.functions.invoke("get-account-insights", {
          body: { ad_account_ids: [id], source: "meta" },
        });
        if (error) throw error;
        await queryClient.invalidateQueries({ queryKey: ["ad-account-insights-detail", id] });
        if (!isAdmin) setLastMetaUpdate(Date.now());
        toast.success("Data updated from Meta");
      }
    } catch (err: any) {
      toast.error(friendlyEdgeError(err));
    } finally {
      setUpdatingMeta(false);
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20 text-muted-foreground">Loading...</div>
      </DashboardLayout>
    );
  }

  if (!account) {
    return (
      <DashboardLayout>
        <div className="space-y-4">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <p className="text-center text-muted-foreground py-10">Ad account not found</p>
        </div>
      </DashboardLayout>
    );
  }

  const platformLabel = isTikTok ? "TikTok" : "Meta";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Back button & Update */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center justify-between sm:justify-start gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="px-2">
              <ArrowLeft className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Back to Ad Accounts</span>
              <span className="sm:hidden">Back</span>
            </Button>
          </div>

          {/* Mobile: action buttons in single row + updated time below */}
          <div className="flex flex-col gap-1 sm:hidden">
            <div className="flex items-center gap-1.5 w-full">
              <Button
                size="sm"
                className="flex-1 h-8 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                asChild
              >
                <a
                  href={isTikTok
                    ? `https://ads.tiktok.com/i18n/dashboard?aadvid=${account.account_id}`
                    : `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account.account_id.replace(/^act_/, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  Ad Manager
                </a>
              </Button>
              {!isTikTok && canManageCampaigns && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/ads-manager/${id}`)}
                  className="flex-1 h-8 px-2 text-xs"
                >
                  <Megaphone className="h-3.5 w-3.5 mr-1" />
                  Ads Mgr
                </Button>
              )}
              <Button
                onClick={handleUpdateFromSource}
                disabled={updatingMeta}
                size="sm"
                className="flex-1 h-8 px-2 text-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${updatingMeta ? "animate-spin" : ""}`} />
                Campaign Update
              </Button>
            </div>
            {insights?.updated_at && (
              <span className="text-[10px] text-muted-foreground">
                Updated: {new Date(insights.updated_at).toLocaleString()}
              </span>
            )}
            {isAdmin && account?.external_topup_required && (
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white h-8 text-xs"
                onClick={() => setShowExternalTopUp(true)}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Ext. Top-Up
              </Button>
            )}
          </div>

          {/* Desktop / tablet */}
          <div className="hidden sm:flex items-center gap-2 flex-wrap">
            {insights?.updated_at && (
              <span className="text-xs text-muted-foreground">
                Updated: {new Date(insights.updated_at).toLocaleString()}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 hover:border-emerald-700"
              asChild
            >
              <a
                href={isTikTok
                  ? `https://ads.tiktok.com/i18n/dashboard?aadvid=${account.account_id}`
                  : `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account.account_id.replace(/^act_/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                Go to {isTikTok ? "TikTok" : "Meta"} Ad Manager
              </a>
            </Button>
            {!isTikTok && canManageCampaigns && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/ads-manager/${id}`)}
              >
                <Megaphone className="h-4 w-4 mr-1" />
                CRM Ads Manager
              </Button>
            )}
            <Button onClick={handleUpdateFromSource} disabled={updatingMeta} size="sm">
              <RefreshCw className={`h-4 w-4 mr-1 ${updatingMeta ? "animate-spin" : ""}`} />
              Update from {isTikTok ? "BC" : "Meta"}
            </Button>
            {isAdmin && account?.external_topup_required && (
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={() => setShowExternalTopUp(true)}
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                Top-Up via {account.external_crm_name || "External CRM"}
              </Button>
            )}
          </div>
        </div>

        {/* Performance Metric Cards */}
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Running Campaigns"
            value={insights?.active_campaigns ?? 0}
            icon={Megaphone}
            iconBg="bg-blue-500/10"
            iconColor="text-blue-500"
            size={isMobile ? "xs" : "default"}
          />
          <MetricCard
            title="Today's Spend"
            value={`$${(insights?.today_spend ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            subtitle={`Yesterday: $${(insights?.yesterday_spend ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            icon={DollarSign}
            iconBg="bg-green-500/10"
            iconColor="text-green-500"
            size={isMobile ? "xs" : "default"}
          />
          <MetricCard
            title="Today's Orders"
            value={insights?.today_orders ?? 0}
            subtitle={`Yesterday: ${insights?.yesterday_orders ?? 0}`}
            icon={ShoppingCart}
            iconBg="bg-orange-500/10"
            iconColor="text-orange-500"
            size={isMobile ? "xs" : "default"}
          />
          <MetricCard
            title="Today's Messages"
            value={insights?.today_messages ?? 0}
            subtitle={`Yesterday: ${insights?.yesterday_messages ?? 0}`}
            icon={MessageSquare}
            iconBg="bg-purple-500/10"
            iconColor="text-purple-500"
            size={isMobile ? "xs" : "default"}
          />
        </div>

        {/* === Daily Spending Limit (on-demand Meta fetch) === */}
        {!isTikTok && (
          <Card className="border-primary/20">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Gauge className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Daily Spending Limit</div>
                    {limitData ? (
                      <>
                        <div className="text-2xl font-bold mt-1">
                          {limitData.daily_spend_limit > 0
                            ? `${limitData.currency === "USD" ? "$" : ""}${limitData.daily_spend_limit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${limitData.currency !== "USD" ? ` ${limitData.currency}` : ""}`
                            : "—"}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {limitData.daily_spend_limit > 0
                            ? <span>Meta-set per day limit</span>
                            : <span>Not set by Meta for this account</span>}
                          <span>·</span>
                          <span>Fetched {formatDistanceToNow(new Date(limitData.fetched_at), { addSuffix: true })}</span>
                          {limitData.ip && (
                            <>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1">
                                <Globe className="h-3 w-3" />
                                IP: <code className="text-[11px]">{limitData.ip}</code>
                                {limitData.via === "proxy" && <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">proxy</Badge>}
                              </span>
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground mt-1">
                        Click the button to fetch the latest daily spending limit directly from Meta (via proxy IP).
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={limitData ? "outline" : "default"}
                  onClick={fetchLimits}
                  disabled={limitLoading}
                  className="shrink-0"
                >
                  {limitLoading ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Gauge className="h-4 w-4 mr-2" />
                  )}
                  {limitLoading ? "Fetching..." : limitData ? "Refresh Limit" : "Check Limit"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* === Critical Alerts (full-width, top) === */}
        {isAdmin && isTikTok && account.fraud_flag && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-destructive text-sm">Spending Cap Mismatch Detected</p>
              <p className="text-sm text-destructive/80 mt-1">এই অ্যাকাউন্টে TikTok budget আর CRM spend cap এ mismatch পাওয়া গেছে। নতুন spend cap সেট করলে fraud flag রিসেট হবে।</p>
              <Button size="sm" variant="outline" className="mt-2 border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => { setShowUpdateCap(true); setNewSpendCap(String(account.spend_cap ?? 0)); }}>
                <Settings className="h-3.5 w-3.5 mr-1" />
                Update Spend Cap
              </Button>
            </div>
          </div>
        )}

        {isAdmin && id && !isTikTok && (
          <div className="space-y-2">
            <HackRecoveryPanel adAccountId={id} account={account} />
          </div>
        )}

        {/* === Account Header — full-width compact === */}
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {isTikTok ? (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.88-2.88 2.89 2.89 0 012.88-2.88c.28 0 .56.04.82.12v-3.5a6.37 6.37 0 00-.82-.05A6.34 6.34 0 003.15 15.3a6.34 6.34 0 0010.47 4.81 6.3 6.3 0 001.87-4.51V9.37a8.16 8.16 0 004.73 1.51V7.43a4.85 4.85 0 01-.63-.74z"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z"/>
                    </svg>
                  )}
                </div>
                <div className="min-w-0">
                  {isRenaming ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="h-7 w-full max-w-[240px] text-sm"
                        placeholder="New account name"
                        autoFocus
                      />
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => renameMutation.mutate()} disabled={!newName.trim() || renameMutation.isPending}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setIsRenaming(false)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-sm truncate">{account.account_name}</span>
                      <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => { setNewName(account.account_name); setIsRenaming(true); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-muted-foreground font-mono">ID: {account.account_id.replace(/^act_/, '')}</span>
                    {!isTikTok && (
                      <a href={`https://business.facebook.com/billing_hub/accounts/details?asset_id=${account.account_id.replace(/^act_/, '')}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {isTikTok && (
                      <a href={`https://ads.tiktok.com/i18n/account/payment?aadvid=${account.account_id}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {!isTikTok && (
                      <a
                        href={`https://business.facebook.com/billing_hub/payment_settings/?placement=ads_manager&asset_id=${account.account_id.replace(/^act_/, '')}&payment_account_id_from_jsmodule=${account.account_id.replace(/^act_/, '')}&entrypoint=ads_ecosystem_navigation_ads_billing_tool_plugin&payment_account_id=${account.account_id.replace(/^act_/, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Old Billing
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <StatusBadge status={account.status} />
                <InactiveBadge lastSpendDate={(insights as any)?.last_spend_date} fallbackDate={account.created_at} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* === Two-column grid === */}
        <div className="grid gap-6 md:grid-cols-2 items-start">

          {/* ============ LEFT COLUMN: Account & Cards info ============ */}
          <div className="space-y-6">
            {/* Details — Admin only */}
            {isAdmin && (
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-base">Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-4 pb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Platform</span>
                    <span className="font-medium">{platformLabel}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{isTikTok ? "Business Center" : "Business Manager"}</span>
                    {account.business_managers?.name ? (
                      <a
                        href={isTikTok
                          ? `https://business.tiktok.com/partner/center/${account.business_managers.bm_id}`
                          : `https://business.facebook.com/latest/settings/business_users/?business_id=${account.business_managers.bm_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-primary cursor-pointer hover:underline flex items-center gap-1"
                      >
                        {account.business_managers.name}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="font-medium">—</span>
                    )}
                  </div>
                  {!isTikTok && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Business Name</span>
                      <span className="font-medium">{account.business_name || "—"}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Created</span>
                    <span className="font-medium">{new Date(account.created_at).toLocaleDateString()}</span>
                  </div>
                  {insights?.updated_at && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Last Refreshed</span>
                      <span className="font-medium">{formatDistanceToNow(new Date(insights.updated_at), { addSuffix: true })}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Payment Methods (Meta only, admin only) */}
            {isAdmin && id && !isTikTok && (
              <AdAccountPaymentMethods
                adAccountId={id}
                currentCards={
                  Array.isArray(insights?.cards)
                    ? (insights.cards as { id?: string; display_string: string }[])
                    : []
                }
                isAdmin={isAdmin}
              />
            )}

            {/* Card History (Meta + Admin only) */}
            {isAdmin && id && !isTikTok && <CardHistoryTimeline adAccountId={id} />}

            {/* Partner BMs (Meta + Admin only) */}
            {isAdmin && id && !isTikTok && <AdAccountPartners adAccountId={id} />}
          </div>

          {/* ============ RIGHT COLUMN: Admin actions & history ============ */}
          <div className="space-y-6">
            {/* Assignment (Admin only) */}
            {isAdmin && (
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Client Assignment
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <Label className="text-sm text-muted-foreground mb-2 block">Assigned To</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                        {assignedUserId
                          ? clients?.find((c: any) => c.user_id === assignedUserId)?.full_name ||
                            clients?.find((c: any) => c.user_id === assignedUserId)?.email ||
                            "Assigned"
                          : "Unassigned"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0">
                      <Command>
                        <CommandInput placeholder="Search client..." />
                        <CommandList>
                          <CommandEmpty>No client found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="unassigned"
                              onSelect={() => assignMutation.mutate(null)}
                            >
                              <Check className={`mr-2 h-4 w-4 ${!assignedUserId ? "opacity-100" : "opacity-0"}`} />
                              Unassigned
                            </CommandItem>
                            {clients?.map((c: any) => (
                              <CommandItem
                                key={c.user_id}
                                value={`${c.full_name || ""} ${c.email || ""}`}
                                onSelect={() => assignMutation.mutate(c.user_id)}
                              >
                                <Check className={`mr-2 h-4 w-4 ${assignedUserId === c.user_id ? "opacity-100" : "opacity-0"}`} />
                                {c.full_name || c.email || c.user_id}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </CardContent>
              </Card>
            )}

            {/* Admin Notes (Admin only) */}
            {isAdmin && id && <AdminNotes adAccountId={id} />}

            {/* External CRM Top-Up Configuration (Admin only) */}
            {isAdmin && account && (
              <ExternalTopUpConfigSection account={account} />
            )}

            {/* Silent BM Recovery action (Meta + Admin only) */}
            {isAdmin && id && !isTikTok && (
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    Counter-Hack Recovery
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-xs text-muted-foreground mb-3">
                    Run silent BM recovery if this account has been hijacked or compromised.
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowSilentRecovery(true)}
                    className="w-full"
                  >
                    <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                    🛡️ Silent BM Recovery
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Spending Limit History — collapsible, last */}
            <Card>
              <CardHeader className="cursor-pointer py-3 px-4" onClick={() => setShowLimitHistory(!showLimitHistory)}>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Spending Limit History
                    {limitHistory?.length ? (
                      <span className="text-xs font-normal text-muted-foreground">({limitHistory.length})</span>
                    ) : null}
                  </CardTitle>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    {showLimitHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </div>
              </CardHeader>
              {showLimitHistory && (
                <CardContent className="px-4 pb-4">
                  {!limitHistory?.length ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No spending limit changes found.</p>
                  ) : (
                    isMobile ? (
                      <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {limitHistory.map((row: any, idx: number) => (
                          <div key={idx} className="border rounded-lg p-3 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">
                                {new Date(row.date).toLocaleString("en-US", {
                                  month: "short", day: "numeric", year: "numeric",
                                  hour: "numeric", minute: "2-digit", hour12: true,
                                })}
                              </span>
                              <span className={`text-sm font-bold font-mono ${row.added > 0 ? "text-emerald-600" : row.added < 0 ? "text-destructive" : ""}`}>
                                {row.added > 0 ? "+" : ""}${row.added.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                ${row.oldCap.toLocaleString(undefined, { minimumFractionDigits: 2 })} → ${row.newCap.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              By: <span className="font-medium text-foreground">{row.updatedBy}</span>
                            </div>
                          </div>
                        ))}
                        <div className="border rounded-lg p-3 bg-muted/50">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold">Total Added</span>
                            <span className="text-sm font-bold font-mono text-emerald-600">
                              +${(limitHistory.reduce((sum: number, r: any) => sum + (r.added > 0 ? r.added : 0), 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border overflow-auto max-h-[400px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead className="text-right">Previous</TableHead>
                              <TableHead className="text-right">New</TableHead>
                              <TableHead className="text-right">Added</TableHead>
                              <TableHead>By</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {limitHistory.map((row: any, idx: number) => (
                              <TableRow key={idx}>
                                <TableCell className="whitespace-nowrap text-sm">
                                  {new Date(row.date).toLocaleString("en-US", {
                                    month: "short", day: "numeric", year: "numeric",
                                    hour: "numeric", minute: "2-digit", hour12: true,
                                  })}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  ${row.oldCap.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm font-medium">
                                  ${row.newCap.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className={`text-right font-mono text-sm font-semibold ${row.added > 0 ? "text-emerald-600" : row.added < 0 ? "text-destructive" : ""}`}>
                                  {row.added > 0 ? "+" : ""}{row.added.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">{row.updatedBy}</TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="bg-muted/50 font-semibold">
                              <TableCell colSpan={3} className="text-right text-sm">Total Added</TableCell>
                              <TableCell className="text-right font-mono text-sm text-emerald-600">
                                +${(limitHistory.reduce((sum: number, r: any) => sum + (r.added > 0 ? r.added : 0), 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell />
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    )
                  )}
                </CardContent>
              )}
            </Card>
          </div>
        </div>

        <Dialog open={showTopUp} onOpenChange={setShowTopUp}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Top Up — {account?.account_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label>Amount (USD)</Label>
                <Input
                  type="number"
                  placeholder="Enter amount"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  min="1"
                  autoFocus
                />
              </div>
              {assignedUserId && (
                <p className="text-xs text-muted-foreground">
                  Wallet will be deducted for assigned client.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowTopUp(false)}>Cancel</Button>
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={() => topUpMutation.mutate()}
                disabled={topUpMutation.isPending || !topUpAmount}
              >
                {topUpMutation.isPending ? "Processing..." : "Top Up"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Update Spend Cap Dialog */}
        <Dialog open={showUpdateCap} onOpenChange={setShowUpdateCap}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Update Spend Cap — {account?.account_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {account?.fraud_flag && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Fraud flag রিসেট হবে।
                </div>
              )}
              <div>
                <Label>New Spend Cap (USD)</Label>
                <Input
                  type="number"
                  placeholder="Enter exact spend cap"
                  value={newSpendCap}
                  onChange={(e) => setNewSpendCap(e.target.value)}
                  min="0"
                  autoFocus
                />
              </div>
              <div className="text-sm text-muted-foreground">
                Current: <span className="font-medium text-foreground">${Number(account?.spend_cap ?? 0).toLocaleString()}</span>
                {newSpendCap && <> → New: <span className="font-medium text-foreground">${Number(newSpendCap).toLocaleString()}</span></>}
              </div>
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-300">
                ⚠️ TikTok billing page open হবে — manually same value সেট করুন।
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowUpdateCap(false)}>Cancel</Button>
              <Button onClick={() => updateCapMutation.mutate()} disabled={updateCapMutation.isPending || !newSpendCap}>
                {updateCapMutation.isPending ? "Updating..." : "Update Cap"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* External CRM Top-Up Dialog */}
        {isAdmin && account && (
          <ExternalTopUpDialog
            open={showExternalTopUp}
            onOpenChange={setShowExternalTopUp}
            account={account}
          />
        )}

        {/* Silent BM Recovery Dialog */}
        {isAdmin && id && (
          <SilentRecoveryDialog
            open={showSilentRecovery}
            onOpenChange={setShowSilentRecovery}
            adAccountId={id}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
