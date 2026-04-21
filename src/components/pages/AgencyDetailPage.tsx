import { useState } from "react";
import { useParams, useNavigate } from "@/lib/router-compat";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { SpendProgressBar } from "@/components/SpendProgressBar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, friendlyEdgeError } from "@/lib/utils";
import { toast } from "sonner";
import {
  User, Building2, Phone, CalendarDays, Wallet, MonitorSmartphone,
  CheckCircle, XCircle, TrendingUp, TrendingDown, DollarSign, CalendarIcon, Save,
  Plus, Minus, ArrowUpCircle, CreditCard, Shield, Receipt, ShoppingCart, RefreshCw, ListChecks, Search, LayoutDashboard, FileText, LogIn, AppWindow, ExternalLink, Loader2, Copy, Edit2
} from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { CardBrandIcon } from "@/components/CardBrandIcon";

export default function AgencyDetailPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { user: currentUser, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const [dateFrom, setDateFrom] = useState<Date | undefined>(startOfMonth(new Date()));
  const [dateTo, setDateTo] = useState<Date | undefined>(endOfMonth(new Date()));

  // Agency info editing
  const [editingAgencyName, setEditingAgencyName] = useState(false);
  const [agencyNameInput, setAgencyNameInput] = useState("");
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugInput, setSlugInput] = useState("");
  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");

  // Wallet adjust dialog
  const [walletDialogType, setWalletDialogType] = useState<"credit" | "debit" | null>(null);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletNote, setWalletNote] = useState("");

  // Top-up / withdraw tabbed dialog
  const [topUpDialogOpen, setTopUpDialogOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [dialogTab, setDialogTab] = useState<"topup" | "withdraw">("topup");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawMeta, setWithdrawMeta] = useState<{ max_withdrawable: number; current_spend_cap: number; real_amount_spent: number } | null>(null);
  const [fetchingWithdrawMeta, setFetchingWithdrawMeta] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");

  // Bulk assign/unassign
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignSelectedIds, setAssignSelectedIds] = useState<Set<string>>(new Set());
  const [unassignSelectedIds, setUnassignSelectedIds] = useState<Set<string>>(new Set());
  const [showUnassignCheckboxes, setShowUnassignCheckboxes] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");

  // Fetch agency
  const { data: agency } = useQuery({
    queryKey: ["agency-detail", agencyId],
    queryFn: async () => {
      const { data } = await supabase.from("agencies").select("*").eq("id", agencyId!).single();
      return data;
    },
    enabled: !!agencyId,
  });

  const userId = agency?.owner_id;

  // Agency wallet
  const { data: agencyWallet } = useQuery({
    queryKey: ["agency-detail-wallet", agencyId],
    queryFn: async () => {
      const { data } = await supabase.from("agency_wallets").select("*").eq("agency_id", agencyId!).single();
      return data;
    },
    enabled: !!agencyId,
  });

  // Owner profile
  const { data: profile } = useQuery({
    queryKey: ["client-detail-profile", userId],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("user_id", userId!).single();
      return data as any;
    },
    enabled: !!userId,
  });

  // Owner wallet (user wallet)
  const { data: wallet } = useQuery({
    queryKey: ["client-detail-wallet", userId],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("*").eq("user_id", userId!).single();
      return data as any;
    },
    enabled: !!userId,
  });

  const { data: adAccounts, refetch: refetchAdAccounts } = useQuery({
    queryKey: ["client-detail-ad-accounts", userId],
    queryFn: async () => {
      const { data: assignments } = await (supabase as any)
        .from("user_ad_accounts")
        .select("ad_account_id")
        .eq("user_id", userId!);
      if (!assignments || assignments.length === 0) return [];
      const ids = assignments.map((a: any) => a.ad_account_id);
      const { data } = await supabase.from("ad_accounts").select("*").in("id", ids);
      return (data as any[]) ?? [];
    },
    enabled: !!userId,
  });

  const { data: allAdAccounts } = useQuery({
    queryKey: ["all-ad-accounts-for-assign"],
    queryFn: async () => {
      const { data } = await supabase.from("ad_accounts").select("id, account_name, account_id");
      return (data as any[]) ?? [];
    },
    enabled: showAssignDialog,
  });

  const [insightsLoading, setInsightsLoading] = useState(false);

  const { data: insights, refetch: refetchInsights } = useQuery({
    queryKey: ["client-detail-insights", userId, adAccounts?.map((a: any) => a.id)],
    queryFn: async () => {
      if (!adAccounts || adAccounts.length === 0) return {};
      const ids = adAccounts.map((a: any) => a.id);
      const { data } = await supabase.functions.invoke("get-account-insights", {
        body: { ad_account_ids: ids, source: "cache" },
      });
      return data?.insights ?? {};
    },
    enabled: !!adAccounts && adAccounts.length > 0,
  });

  const { data: topUpTotal } = useQuery({
    queryKey: ["client-detail-topup-total", userId, dateFrom?.toISOString(), dateTo?.toISOString()],
    queryFn: async () => {
      let query = supabase.from("top_up_requests").select("amount").eq("user_id", userId!).eq("status", "approved");
      if (dateFrom) query = query.gte("created_at", dateFrom.toISOString());
      if (dateTo) { const end = new Date(dateTo); end.setHours(23, 59, 59, 999); query = query.lte("created_at", end.toISOString()); }
      const { data } = await query;
      return (data as any[])?.reduce((sum: number, r: any) => sum + Number(r.amount), 0) ?? 0;
    },
    enabled: !!userId,
  });

  const { data: totalSpendingFiltered } = useQuery({
    queryKey: ["client-detail-spending", userId, dateFrom?.toISOString(), dateTo?.toISOString()],
    queryFn: async () => {
      let query = supabase.from("transactions").select("amount").eq("user_id", userId!).eq("type", "ad_topup");
      if (dateFrom) query = query.gte("created_at", dateFrom.toISOString());
      if (dateTo) { const end = new Date(dateTo); end.setHours(23, 59, 59, 999); query = query.lte("created_at", end.toISOString()); }
      const { data } = await query;
      return (data as any[])?.reduce((sum: number, r: any) => sum + Math.abs(Number(r.amount)), 0) ?? 0;
    },
    enabled: !!userId,
  });

  const { data: transactions } = useQuery({
    queryKey: ["client-detail-transactions", userId],
    queryFn: async () => {
      const { data } = await supabase.from("transactions").select("*").eq("user_id", userId!).order("created_at", { ascending: false });
      return (data as any[]) ?? [];
    },
    enabled: !!userId,
  });

  const { data: clients } = useQuery({
    queryKey: ["agency-detail-clients", agencyId],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("agency_id", agencyId!);
      return data || [];
    },
    enabled: !!agencyId,
  });

  const adminProfileIds = [...new Set((transactions ?? []).map((tx: any) => { const pb = tx.processed_by || ""; if (pb.startsWith("admin:")) return pb.split(":")[1]; return null; }).filter(Boolean))];
  const { data: allProfiles } = useQuery({
    queryKey: ["admin-profiles-for-tx", adminProfileIds.join(",")],
    queryFn: async () => {
      if (adminProfileIds.length === 0) return [];
      const { data } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", adminProfileIds);
      return (data as any[]) ?? [];
    },
    enabled: adminProfileIds.length > 0,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["client-detail-profile", userId] });
    queryClient.invalidateQueries({ queryKey: ["client-detail-wallet", userId] });
    queryClient.invalidateQueries({ queryKey: ["client-detail-transactions", userId] });
    queryClient.invalidateQueries({ queryKey: ["client-detail-ad-accounts", userId] });
    queryClient.invalidateQueries({ queryKey: ["agency-detail", agencyId] });
    queryClient.invalidateQueries({ queryKey: ["agency-detail-wallet", agencyId] });
  };

  const saveAgencyField = async (field: string, value: any) => {
    const { error } = await supabase.from("agencies").update({ [field]: value } as any).eq("id", agencyId!);
    if (error) { toast.error(error.message); return; }
    toast.success(`${field} updated!`);
    invalidateAll();
  };

  const handleDeposit = async () => {
    const amt = Number(depositAmount);
    if (amt <= 0) { toast.error("Invalid amount"); return; }
    if (!agencyWallet) { toast.error("Wallet not found"); return; }
    const { error } = await supabase.from("agency_wallets").update({
      balance: Number(agencyWallet.balance) + amt,
      total_deposited: Number(agencyWallet.total_deposited) + amt,
    } as any).eq("agency_id", agencyId!);
    if (error) { toast.error(error.message); return; }
    toast.success(`$${amt} deposited`);
    setShowDeposit(false);
    setDepositAmount("");
    invalidateAll();
  };

  const walletBalance = Number(wallet?.balance ?? 0);

  const walletAdjustMutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(walletAmount);
      if (!amt || amt <= 0) throw new Error("Invalid amount");

      // Always fetch LIVE balance from DB to avoid stale-cache races.
      const { data: liveWallet, error: fetchErr } = await supabase
        .from("wallets")
        .select("balance")
        .eq("user_id", userId!)
        .single();
      if (fetchErr) throw fetchErr;

      const currentBalance = Number(liveWallet?.balance ?? 0);
      const isCredit = walletDialogType === "credit";
      const newBalance = isCredit ? currentBalance + amt : currentBalance - amt;
      const txAmount = isCredit ? amt : -amt;
      const { error: walletErr } = await supabase.from("wallets").update({ balance: newBalance } as any).eq("user_id", userId!);
      if (walletErr) throw walletErr;
      const { error: txErr } = await supabase.from("transactions").insert({
        user_id: userId!,
        amount: txAmount,
        balance_after: newBalance,
        type: isCredit ? "admin_credit" : "admin_debit",
        description: walletNote.trim() || (isCredit ? "Admin added balance" : "Admin deducted balance"),
        processed_by: `admin:${currentUser!.id}`,
      } as any);
      if (txErr) throw txErr;
    },
    onSuccess: () => {
      toast.success(walletDialogType === "credit" ? "Balance added!" : "Balance deducted!");
      setWalletDialogType(null); setWalletAmount(""); setWalletNote("");
      invalidateAll();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const topUpMutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(topUpAmount);
      if (!amt || amt <= 0) throw new Error("Invalid amount");
      const { data, error } = await supabase.functions.invoke("spend-cap-update", {
        body: { ad_account_id: selectedAccountId, amount: amt, deduct_wallet: true, target_user_id: userId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Spend cap updated: $${Number(data.old_spend_cap).toLocaleString()} → $${Number(data.new_spend_cap).toLocaleString()}`);
      setTopUpDialogOpen(false); setSelectedAccountId(""); setTopUpAmount("");
      invalidateAll();
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
  });

  const fetchWithdrawMeta = async (accountId: string) => {
    setWithdrawAmount(""); setWithdrawMeta(null); setFetchingWithdrawMeta(true);
    try {
      const { data, error } = await supabase.functions.invoke("spend-cap-withdraw", { body: { ad_account_id: accountId, amount: 1, dry_run: true } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setWithdrawMeta({ max_withdrawable: data.max_withdrawable, current_spend_cap: data.current_spend_cap, real_amount_spent: data.real_amount_spent });
    } catch {
      const acc = adAccounts?.find((a: any) => a.id === accountId);
      setWithdrawMeta({ real_amount_spent: Number(acc?.amount_spent ?? 0), current_spend_cap: Number(acc?.spend_cap ?? 0), max_withdrawable: Math.max(0, Number(acc?.spend_cap ?? 0) - Number(acc?.amount_spent ?? 0)) });
    } finally { setFetchingWithdrawMeta(false); }
  };

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(withdrawAmount);
      if (!amt || amt <= 0) throw new Error("Invalid amount");
      const { data, error } = await supabase.functions.invoke("spend-cap-withdraw", { body: { ad_account_id: selectedAccountId, amount: amt } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Withdrawn! Cap: $${Number(data.old_spend_cap).toLocaleString()} → $${Number(data.new_spend_cap).toLocaleString()}`);
      setTopUpDialogOpen(false); setSelectedAccountId(""); setWithdrawAmount(""); setWithdrawMeta(null); setDialogTab("topup");
      invalidateAll();
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
  });

  const activeAccounts = adAccounts?.filter((a: any) => a.status === "active") ?? [];
  const disabledAccounts = adAccounts?.filter((a: any) => a.status !== "active") ?? [];
  const totalRemaining = adAccounts?.reduce((sum: number, a: any) => sum + (Number(a.spend_cap) - Number(a.amount_spent)), 0) ?? 0;
  const totalSpending = adAccounts?.reduce((sum: number, a: any) => sum + Number(a.amount_spent), 0) ?? 0;
  const isActive = agency?.status === "active";

  const todaySpend = insights ? Object.values(insights).reduce((sum: number, i: any) => sum + Number(i.today_spend ?? 0), 0) : 0;
  const yesterdaySpend = insights ? Object.values(insights).reduce((sum: number, i: any) => sum + Number(i.yesterday_spend ?? 0), 0) : 0;
  const todayOrders = insights ? Object.values(insights).reduce((sum: number, i: any) => sum + Number(i.today_orders ?? 0), 0) : 0;
  const yesterdayOrders = insights ? Object.values(insights).reduce((sum: number, i: any) => sum + Number(i.yesterday_orders ?? 0), 0) : 0;

  const subdomainLink = agency?.slug ? `https://crmsoftit.lovable.app?agency=${agency.slug}` : "";
  const copyLink = () => { navigator.clipboard.writeText(subdomainLink); toast.success("Link copied!"); };
  const activeClients = clients?.filter(c => c.status === "active").length || 0;

  return (
    <DashboardLayout>
      <div className={cn("space-y-5", isMobile && "space-y-4")}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground">{agency?.name || "Agency"}</h1>
                <Badge variant="outline" className="text-xs">Agency</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{profile?.email || ""}</p>
            </div>
            <StatusBadge status={isActive ? "active" : "inactive"} />
          </div>
          <div className="flex items-center gap-2">
            {isSuperAdmin && (
              <Button
                size="sm"
                variant="outline"
                className="text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                onClick={async () => {
                  try {
                    const res = await supabase.functions.invoke("impersonate-client", { body: { target_user_id: userId } });
                    if (res.error) throw new Error(res.error.message);
                    if (res.data?.error) throw new Error(res.data.error);
                    if (res.data?.url) { window.open(res.data.url, "_blank"); toast.success("Opening agency dashboard..."); }
                  } catch (err: any) { toast.error(err.message || "Failed"); }
                }}
              >
                <LogIn className="h-3.5 w-3.5 mr-1" />Login as Agency
              </Button>
            )}
            <Button
              className="bg-gradient-to-r from-primary to-primary/75 hover:from-primary/90 hover:to-primary/70 text-primary-foreground shadow-md shadow-primary/25 rounded-full px-5 font-semibold"
              onClick={() => { setTopUpDialogOpen(true); setSelectedAccountId(""); setTopUpAmount(""); setDialogTab("topup"); }}
            >
              <ArrowUpCircle className="h-4 w-4 mr-2" />Top Up
            </Button>
          </div>
        </div>

        {!isActive && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive font-medium">
            ⚠️ This agency is currently inactive.
          </div>
        )}

        {/* Main Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Date Range Filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Period:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("w-[140px] justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
                    <CalendarIcon className="mr-1 h-3 w-3" />
                    {dateFrom ? format(dateFrom, "MMM d, yyyy") : "From"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground">—</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("w-[140px] justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
                    <CalendarIcon className="mr-1 h-3 w-3" />
                    {dateTo ? format(dateTo, "MMM d, yyyy") : "To"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <TabsList className="bg-muted/60 p-1 rounded-lg">
              <TabsTrigger value="info" className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Building2 className="h-3.5 w-3.5" />
                Agency Info
              </TabsTrigger>
              <TabsTrigger value="overview" className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <LayoutDashboard className="h-3.5 w-3.5" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="transactions" className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Receipt className="h-3.5 w-3.5" />
                Transactions
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Agency Info Tab */}
          <TabsContent value="info" className="mt-0">
            <Card className={cn("border-border/40 shadow-[0_2px_12px_rgba(0,0,0,0.04)]", !isActive && "border-destructive/50 bg-destructive/5")}>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  Agency Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {/* Agency Name */}
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4 transition-colors hover:bg-muted/50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Agency Name</p>
                      {editingAgencyName ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Input className="w-32 h-7 text-sm" value={agencyNameInput} onChange={(e) => setAgencyNameInput(e.target.value)} />
                          <Button size="icon" className="h-7 w-7" onClick={() => { saveAgencyField("name", agencyNameInput); setEditingAgencyName(false); }}><Save className="h-3 w-3" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingAgencyName(false)}><XCircle className="h-3 w-3" /></Button>
                        </div>
                      ) : (
                        <p className="font-semibold text-sm cursor-pointer hover:text-primary transition-colors" onClick={() => { setAgencyNameInput(agency?.name ?? ""); setEditingAgencyName(true); }}>{agency?.name || "—"}</p>
                      )}
                    </div>
                  </div>

                  {/* Slug */}
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4 transition-colors hover:bg-muted/50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
                      <ExternalLink className="h-4 w-4 text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Slug</p>
                      {editingSlug ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Input className="w-32 h-7 text-sm" value={slugInput} onChange={(e) => setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
                          <Button size="icon" className="h-7 w-7" onClick={() => { saveAgencyField("slug", slugInput); setEditingSlug(false); }}><Save className="h-3 w-3" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingSlug(false)}><XCircle className="h-3 w-3" /></Button>
                        </div>
                      ) : (
                        <p className="font-semibold text-sm font-mono cursor-pointer hover:text-primary transition-colors" onClick={() => { setSlugInput(agency?.slug ?? ""); setEditingSlug(true); }}>{agency?.slug || "—"}</p>
                      )}
                    </div>
                  </div>

                  {/* Subdomain Link */}
                  {subdomainLink && (
                    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4 transition-colors hover:bg-muted/50">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                        <ExternalLink className="h-4 w-4 text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Subdomain Link</p>
                        <div className="flex items-center gap-1">
                          <a href={subdomainLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-sm truncate">{subdomainLink}</a>
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={copyLink}><Copy className="h-3 w-3" /></Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* USD Rate */}
                  <div className="flex items-center gap-3 rounded-xl border border-cyan-200/60 bg-cyan-50/40 dark:bg-cyan-950/20 dark:border-cyan-800/40 p-4 transition-colors hover:bg-cyan-50/60">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
                      <DollarSign className="h-4 w-4 text-cyan-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">USD Rate</p>
                      {editingRate ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Input type="number" step="0.01" className="w-20 h-7 text-sm" value={rateInput} onChange={(e) => setRateInput(e.target.value)} />
                          <Button size="icon" className="h-7 w-7" onClick={() => { saveAgencyField("usd_rate", Number(rateInput)); setEditingRate(false); }}><Save className="h-3 w-3" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingRate(false)}><XCircle className="h-3 w-3" /></Button>
                        </div>
                      ) : (
                        <p className="font-semibold text-sm text-cyan-700 dark:text-cyan-400 cursor-pointer hover:text-cyan-500 transition-colors" onClick={() => { setRateInput(String(agency?.usd_rate ?? "")); setEditingRate(true); }}>
                          {agency?.usd_rate ? `৳${agency.usd_rate}` : "Not set"}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Owner */}
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4 transition-colors hover:bg-muted/50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                      <User className="h-4 w-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Owner</p>
                      <p className="font-semibold text-sm">{profile?.full_name || profile?.email || "—"}</p>
                    </div>
                  </div>

                  {/* Subscription */}
                  <div className="flex items-center gap-3 rounded-xl border border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/20 dark:border-amber-800/40 p-4 transition-colors hover:bg-amber-50/60">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                      <CalendarDays className="h-4 w-4 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Subscription</p>
                      <p className="font-semibold text-sm">${Number(agency?.subscription_fee || 0)}/mo</p>
                      {agency?.subscription_paid_until && (
                        <Badge variant={new Date(agency.subscription_paid_until) < new Date() ? "destructive" : "default"} className="mt-1 text-[10px]">
                          {new Date(agency.subscription_paid_until) < new Date() ? "Expired" : `Until ${format(new Date(agency.subscription_paid_until), "MMM dd, yyyy")}`}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Active Clients */}
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4 transition-colors hover:bg-muted/50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                      <User className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Clients</p>
                      <p className="font-semibold text-sm">{activeClients} active / {clients?.length || 0} total</p>
                    </div>
                  </div>

                  {/* Agency Wallet */}
                  <div className="flex items-center gap-3 rounded-xl border border-emerald-200/60 bg-emerald-50/40 dark:bg-emerald-950/20 dark:border-emerald-800/40 p-4 transition-colors hover:bg-emerald-50/60">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                      <Wallet className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Agency Wallet</p>
                      <p className="font-semibold text-sm text-emerald-700 dark:text-emerald-400">${Number(agencyWallet?.balance || 0).toLocaleString()}</p>
                      <Button size="sm" variant="outline" className="mt-1 h-6 text-[10px] px-2" onClick={() => setShowDeposit(true)}>
                        <Plus className="h-2.5 w-2.5 mr-0.5" /> Deposit
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Clients Table */}
                {clients && clients.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold mb-2">Sub-Clients ({clients.length})</h3>
                    <div className="overflow-x-auto border rounded-lg">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Company</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {clients.map(c => (
                            <TableRow key={c.user_id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/clients/${c.user_id}`)}>
                              <TableCell className="font-medium">{c.full_name || "—"}</TableCell>
                              <TableCell>{c.email}</TableCell>
                              <TableCell>{c.company || "—"}</TableCell>
                              <TableCell><Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-0">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Today's Performance</h3>
              <Button
                variant="outline" size="sm" className="rounded-full"
                disabled={insightsLoading || !adAccounts || adAccounts.length === 0}
                onClick={async () => {
                  if (!adAccounts || adAccounts.length === 0) return;
                  setInsightsLoading(true);
                  try {
                    const ids = adAccounts.map((a: any) => a.id);
                    const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
                    await chunkedMetaSync(ids);
                    await Promise.all([refetchInsights(), refetchAdAccounts()]);
                    toast.success("Insights updated from Meta!");
                  } catch { toast.error("Failed to update from Meta"); } finally { setInsightsLoading(false); }
                }}
              >
                <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", insightsLoading && "animate-spin")} />
                {insightsLoading ? "Updating..." : "Update from Meta"}
              </Button>
            </div>

            {/* Desktop Metrics */}
            <div className="space-y-3">
              <div className="grid gap-2 grid-cols-2 lg:grid-cols-5">
                {[
                  { label: "Today's Spend", value: `$${todaySpend.toLocaleString()}`, sub: `Yesterday: $${yesterdaySpend.toLocaleString()}`, bg: "bg-emerald-50 dark:bg-emerald-950/30", accent: "bg-emerald-500", icon: DollarSign, iconColor: "text-white" },
                  { label: "Today's Orders", value: todayOrders.toLocaleString(), sub: `Yesterday: ${yesterdayOrders.toLocaleString()}`, bg: "bg-sky-50 dark:bg-sky-950/30", accent: "bg-sky-500", icon: ShoppingCart, iconColor: "text-white" },
                  { label: "Total Top-Up", value: `$${Number(topUpTotal ?? 0).toLocaleString()}`, sub: dateFrom && dateTo ? `${format(dateFrom, "MMM d")} - ${format(dateTo, "MMM d, yyyy")}` : "All time", bg: "bg-amber-50 dark:bg-amber-950/30", accent: "bg-amber-500", icon: TrendingUp, iconColor: "text-white" },
                  { label: "Total Spending", value: `$${(totalSpendingFiltered ?? totalSpending).toLocaleString()}`, sub: dateFrom && dateTo ? `${format(dateFrom, "MMM d")} - ${format(dateTo, "MMM d, yyyy")}` : "All time", bg: "bg-violet-50 dark:bg-violet-950/30", accent: "bg-violet-500", icon: TrendingDown, iconColor: "text-white" },
                  { label: "Remaining Balance", value: `$${totalRemaining.toLocaleString()}`, sub: "All ad accounts", bg: "bg-rose-50 dark:bg-rose-950/30", accent: "bg-rose-500", icon: Wallet, iconColor: "text-white" },
                ].map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <div key={i} className={cn("rounded-2xl px-5 py-5 flex items-center gap-3.5", item.bg)}>
                      <div className={cn("flex shrink-0 items-center justify-center rounded-xl h-11 w-11", item.accent)}>
                        <Icon className={cn("h-5 w-5", item.iconColor)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80 leading-tight">{item.label}</p>
                        <p className="text-xl font-extrabold tracking-tight text-foreground leading-snug mt-1">{item.value}</p>
                        <p className="text-[11px] font-medium text-muted-foreground/70 leading-none mt-1">{item.sub}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <Card className="border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex shrink-0 items-center justify-center rounded-xl h-9 w-9 bg-blue-100 dark:bg-blue-900/40"><Wallet className="h-4.5 w-4.5 text-blue-600" /></div>
                      <p className="text-sm font-semibold text-foreground">Wallet Balance</p>
                      <div className="flex items-center gap-0.5 ml-auto shrink-0">
                        <button className="h-6 w-6 rounded-md flex items-center justify-center text-green-600 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors" onClick={() => { setWalletDialogType("credit"); setWalletAmount(""); setWalletNote(""); }}><Plus className="h-3 w-3" /></button>
                        <button className="h-6 w-6 rounded-md flex items-center justify-center text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors" onClick={() => { setWalletDialogType("debit"); setWalletAmount(""); setWalletNote(""); }}><Minus className="h-3 w-3" /></button>
                      </div>
                    </div>
                    <p className="text-2xl font-bold tracking-tight text-foreground">${walletBalance.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card className="border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex shrink-0 items-center justify-center rounded-xl h-9 w-9 bg-teal-100 dark:bg-teal-900/40"><MonitorSmartphone className="h-4.5 w-4.5 text-teal-600" /></div>
                      <p className="text-sm font-semibold text-foreground">Total Ad Accounts</p>
                    </div>
                    <p className="text-2xl font-bold tracking-tight text-foreground">{adAccounts?.length ?? 0}</p>
                  </CardContent>
                </Card>
                <Card className="border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex shrink-0 items-center justify-center rounded-xl h-9 w-9 bg-emerald-100 dark:bg-emerald-900/40"><CheckCircle className="h-4.5 w-4.5 text-emerald-600" /></div>
                      <p className="text-sm font-semibold text-foreground">Active Accounts</p>
                    </div>
                    <p className="text-2xl font-bold tracking-tight text-foreground">{activeAccounts.length}</p>
                  </CardContent>
                </Card>
                <Card className="border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex shrink-0 items-center justify-center rounded-xl h-9 w-9 bg-red-100 dark:bg-red-900/40"><XCircle className="h-4.5 w-4.5 text-red-600" /></div>
                      <p className="text-sm font-semibold text-foreground">Disabled Accounts</p>
                    </div>
                    <p className="text-2xl font-bold tracking-tight text-foreground">{disabledAccounts.length}</p>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Ad Accounts Table */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-foreground">Ad Accounts ({adAccounts?.length ?? 0})</h2>
                <div className="flex items-center gap-1.5">
                  {showUnassignCheckboxes && unassignSelectedIds.size > 0 && (
                    <Button variant="outline" size="sm" className="rounded-full text-xs h-7" onClick={async () => {
                      const ids = Array.from(unassignSelectedIds);
                      for (const adAccountId of ids) { await (supabase as any).from("user_ad_accounts").delete().eq("user_id", userId!).eq("ad_account_id", adAccountId); }
                      toast.success(`${ids.length} account(s) unassigned`);
                      setUnassignSelectedIds(new Set()); setShowUnassignCheckboxes(false); refetchAdAccounts();
                    }}>Unassign {unassignSelectedIds.size}</Button>
                  )}
                  <Button variant={showUnassignCheckboxes ? "secondary" : "ghost"} size="icon" className="h-7 w-7 rounded-full" onClick={() => { setShowUnassignCheckboxes(v => !v); if (showUnassignCheckboxes) setUnassignSelectedIds(new Set()); }}>
                    <ListChecks className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" className="rounded-full h-7 text-xs" onClick={() => { setShowAssignDialog(true); setAssignSelectedIds(new Set()); setAssignSearch(""); }}>
                    <Plus className="h-3 w-3 mr-1" />Assign
                  </Button>
                </div>
              </div>

              <Card className="border-border/40 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
                <CardContent className="p-0">
                  {adAccounts?.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">No ad accounts assigned</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            {showUnassignCheckboxes && (
                              <TableHead className="w-[40px]">
                                <Checkbox checked={adAccounts?.length > 0 && adAccounts?.every((a: any) => unassignSelectedIds.has(a.id))} onCheckedChange={() => {
                                  if (adAccounts?.every((a: any) => unassignSelectedIds.has(a.id))) setUnassignSelectedIds(new Set());
                                  else setUnassignSelectedIds(new Set(adAccounts?.map((a: any) => a.id)));
                                }} />
                              </TableHead>
                            )}
                            <TableHead className="w-[200px]"><span className="text-xs font-medium">Ad Account</span></TableHead>
                            <TableHead className="w-[100px]"><span className="text-xs font-medium">Budget</span></TableHead>
                            <TableHead className="w-[90px]"><span className="text-xs font-medium">Status</span></TableHead>
                            <TableHead className="w-[90px]"><span className="text-xs font-medium">Balance</span></TableHead>
                            <TableHead className="w-[100px]"><span className="text-xs font-medium">Today</span></TableHead>
                            <TableHead className="w-[100px]"><span className="text-xs font-medium">Yesterday</span></TableHead>
                            <TableHead className="w-[110px]"><span className="text-xs font-medium">Card</span></TableHead>
                            <TableHead className="w-[50px]"><span className="text-xs font-medium">Actions</span></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {adAccounts?.map((acc: any) => {
                            const ins = insights?.[acc.id];
                            return (
                              <TableRow key={acc.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/ad-accounts/${acc.id}`)}>
                                {showUnassignCheckboxes && (
                                  <TableCell onClick={(e) => e.stopPropagation()}>
                                    <Checkbox checked={unassignSelectedIds.has(acc.id)} onCheckedChange={() => {
                                      setUnassignSelectedIds(prev => { const next = new Set(prev); if (next.has(acc.id)) next.delete(acc.id); else next.add(acc.id); return next; });
                                    }} />
                                  </TableCell>
                                )}
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted"><AppWindow className="h-4 w-4 text-muted-foreground" /></div>
                                    <div>
                                      <div className="text-sm text-primary">{acc.account_name}</div>
                                      <div className="mt-0.5 flex items-center gap-1.5">
                                        <span className="text-xs text-muted-foreground font-mono">{acc.account_id.replace(/^act_/, '')}</span>
                                        <a href={`https://business.facebook.com/billing_hub/accounts/details?asset_id=${acc.account_id.replace(/^act_/, '')}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" onClick={(e) => e.stopPropagation()}><ExternalLink className="h-3 w-3" /></a>
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell onClick={(e) => e.stopPropagation()}><SpendProgressBar amountSpent={Number(acc.amount_spent)} spendCap={Number(acc.spend_cap)} balanceAfterTopup={Number((acc as any).balance_after_topup ?? 0)} /></TableCell>
                                <TableCell><StatusBadge status={acc.status} /></TableCell>
                                <TableCell className="whitespace-nowrap"><span className="text-sm">${ins?.balance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</span></TableCell>
                                <TableCell className="whitespace-nowrap"><span className="text-sm">${ins?.today_spend?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</span></TableCell>
                                <TableCell className="whitespace-nowrap"><span className="text-sm">${ins?.yesterday_spend?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</span></TableCell>
                                <TableCell>
                                  <div className="text-sm whitespace-nowrap">
                                    {ins?.cards && ins.cards.length > 0 ? ins.cards.map((card: any, i: number) => (
                                      <div key={i} className="flex items-center gap-1.5"><CardBrandIcon displayString={card.display_string} size="xs" /><span>{card.display_string}</span></div>
                                    )) : <span className="text-muted-foreground">—</span>}
                                  </div>
                                </TableCell>
                                <TableCell onClick={(e) => e.stopPropagation()}>
                                  <Button size="icon" variant="default" className="h-8 w-8" onClick={() => { setSelectedAccountId(acc.id); setTopUpDialogOpen(true); setTopUpAmount(""); setDialogTab("topup"); }} title="Top Up">
                                    <ArrowUpCircle className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Transactions Tab */}
          <TabsContent value="transactions" className="mt-0">
            <Card className="border-border/40 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
              <CardHeader className="pb-3"><CardTitle className="text-base font-semibold">Transaction History</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Ad Account</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Balance After</TableHead>
                        <TableHead>Processed By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions?.map((tx: any) => {
                        const linkedAccount = tx.reference_id && tx.type === "ad_topup" ? adAccounts?.find((a: any) => a.id === tx.reference_id) : null;
                        const desc = tx.description || "—";
                        const hasNewline = desc.includes("\n");
                        const [descName, descId] = hasNewline ? desc.split("\n") : [desc, null];
                        const pb = tx.processed_by || "";
                        let processedByLabel = "—";
                        if (pb === "system") processedByLabel = "Auto Approved by System";
                        else if (pb.startsWith("admin:")) { const adminId = pb.split(":")[1]; const adminProf = allProfiles?.find((p: any) => p.user_id === adminId); processedByLabel = adminProf?.full_name || adminProf?.email || adminId.slice(0, 8); }
                        else if (pb.startsWith("client:")) { processedByLabel = profile?.full_name || profile?.email || "Client"; }
                        return (
                          <TableRow key={tx.id}>
                            <TableCell className="text-muted-foreground whitespace-nowrap text-xs">{format(new Date(tx.created_at), "MMM d, yyyy HH:mm")}</TableCell>
                            <TableCell className="capitalize font-medium text-xs">{tx.type.replace(/_/g, " ")}</TableCell>
                            <TableCell className="text-xs">{hasNewline ? (<div><span>{descName}</span><span className="block text-[11px] text-muted-foreground">{descId}</span></div>) : desc}</TableCell>
                            <TableCell className="text-xs">{linkedAccount ? (<div><p className="font-medium">{linkedAccount.account_name}</p><p className="text-[11px] text-muted-foreground font-mono">{linkedAccount.account_id.replace(/^act_/, "")}</p></div>) : (<span className="text-muted-foreground">—</span>)}</TableCell>
                            <TableCell className={cn("font-semibold text-xs", Number(tx.amount) >= 0 ? "text-emerald-600" : "text-destructive")}>{Number(tx.amount) >= 0 ? "+" : ""}${Math.abs(Number(tx.amount)).toLocaleString()}</TableCell>
                            <TableCell className="font-medium text-xs">${Number(tx.balance_after ?? 0).toLocaleString()}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{processedByLabel}</TableCell>
                          </TableRow>
                        );
                      })}
                      {(!transactions || transactions.length === 0) && (
                        <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No transactions yet</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Agency Deposit Dialog */}
      <Dialog open={showDeposit} onOpenChange={setShowDeposit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Deposit to {agency?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Amount (USD)</Label><Input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} /></div>
            <Button onClick={handleDeposit} className="w-full">Deposit</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign Accounts Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Ad Accounts</DialogTitle>
            <DialogDescription>Select accounts to assign to this agency owner.</DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by name or ID..." value={assignSearch} onChange={(e) => setAssignSearch(e.target.value)} className="pl-9 h-9" />
            </div>
            <div className="max-h-[50vh] overflow-y-auto space-y-1">
              {(() => {
                const assignedIds = new Set(adAccounts?.map((a: any) => a.id) ?? []);
                const q = assignSearch.toLowerCase();
                const unassigned = (allAdAccounts?.filter((a: any) => { if (assignedIds.has(a.id)) return false; if (q && !a.account_name?.toLowerCase().includes(q) && !a.account_id?.toLowerCase().includes(q)) return false; return true; }) ?? []);
                if (unassigned.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">No unassigned accounts found</p>;
                return unassigned.map((acc: any) => (
                  <label key={acc.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer">
                    <Checkbox checked={assignSelectedIds.has(acc.id)} onCheckedChange={() => { setAssignSelectedIds(prev => { const next = new Set(prev); if (next.has(acc.id)) next.delete(acc.id); else next.add(acc.id); return next; }); }} />
                    <div><p className="text-sm font-medium">{acc.account_name}</p><p className="text-xs text-muted-foreground">{acc.account_id}</p></div>
                  </label>
                ));
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
            <Button disabled={assignSelectedIds.size === 0} onClick={async () => {
              const ids = Array.from(assignSelectedIds);
              await (supabase as any).from("user_ad_accounts").delete().in("ad_account_id", ids);
              const { error } = await (supabase as any).from("user_ad_accounts").insert(ids.map(adAccountId => ({ user_id: userId, ad_account_id: adAccountId })));
              if (error) { toast.error(error.message); return; }
              toast.success(`${ids.length} account(s) assigned`);
              setShowAssignDialog(false); setAssignSelectedIds(new Set()); refetchAdAccounts();
            }}>Assign {assignSelectedIds.size > 0 ? `${assignSelectedIds.size} ` : ""}Selected</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wallet Adjust Dialog */}
      <Dialog open={!!walletDialogType} onOpenChange={(open) => !open && setWalletDialogType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{walletDialogType === "credit" ? "Add Balance" : "Deduct Balance"}</DialogTitle>
            <DialogDescription>Current balance: <span className="font-semibold">${walletBalance.toLocaleString()}</span></DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label>Amount (USD)</Label><Input type="number" min="0.01" step="0.01" value={walletAmount} onChange={(e) => setWalletAmount(e.target.value)} placeholder="100.00" /></div>
            <div className="space-y-2"><Label>Note (optional)</Label><Textarea value={walletNote} onChange={(e) => setWalletNote(e.target.value)} placeholder="Reason for adjustment..." rows={2} /></div>
            {walletDialogType === "credit" && parseFloat(walletAmount) > 0 && (<p className="text-sm text-muted-foreground">New balance: <span className="font-semibold text-emerald-600">${(walletBalance + parseFloat(walletAmount)).toLocaleString()}</span></p>)}
            {walletDialogType === "debit" && parseFloat(walletAmount) > 0 && (<p className="text-sm text-muted-foreground">New balance: <span className={cn("font-semibold", (walletBalance - parseFloat(walletAmount)) < 0 ? "text-destructive" : "text-emerald-600")}>${(walletBalance - parseFloat(walletAmount)).toLocaleString()}</span></p>)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWalletDialogType(null)}>Cancel</Button>
            <Button onClick={() => walletAdjustMutation.mutate()} disabled={!walletAmount || parseFloat(walletAmount) <= 0 || walletAdjustMutation.isPending}>
              {walletAdjustMutation.isPending ? "Processing..." : walletDialogType === "credit" ? "Add Balance" : "Deduct Balance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Top Up / Withdraw Dialog */}
      <Dialog open={topUpDialogOpen} onOpenChange={(open) => { if (!open) { setTopUpDialogOpen(false); setDialogTab("topup"); setWithdrawMeta(null); setWithdrawAmount(""); setTopUpAmount(""); setSelectedAccountId(""); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{selectedAccountId ? adAccounts?.find((a: any) => a.id === selectedAccountId)?.account_name ?? "Ad Account" : "Ad Account Action"}</DialogTitle>
            <DialogDescription>{selectedAccountId ? adAccounts?.find((a: any) => a.id === selectedAccountId)?.account_id?.replace(/^act_/, '') : "Select an ad account"}</DialogDescription>
          </DialogHeader>
          {!selectedAccountId && (
            <div className="space-y-2">
              <Label>Ad Account</Label>
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger><SelectValue placeholder="Select ad account" /></SelectTrigger>
                <SelectContent>{adAccounts?.map((acc: any) => (<SelectItem key={acc.id} value={acc.id}>{acc.account_name} ({acc.account_id})</SelectItem>))}</SelectContent>
              </Select>
            </div>
          )}
          {selectedAccountId && (
            <Tabs value={dialogTab} onValueChange={(v) => { const tab = v as "topup" | "withdraw"; setDialogTab(tab); if (tab === "withdraw" && !withdrawMeta && !fetchingWithdrawMeta) fetchWithdrawMeta(selectedAccountId); }}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="topup">Increase Limit</TabsTrigger>
                <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
              </TabsList>
              <TabsContent value="topup" className="space-y-4 pt-2">
                <div className="flex justify-between items-center text-sm p-3 rounded-lg bg-muted">
                  <span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Wallet</span>
                  <span className={cn("font-semibold", walletBalance < 0 ? "text-destructive" : "")}>${walletBalance.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Spend Cap</span>
                  <span className="font-medium">${Number(adAccounts?.find((a: any) => a.id === selectedAccountId)?.spend_cap ?? 0).toLocaleString()}</span>
                </div>
                <div className="space-y-2"><Label>Amount to Add (USD)</Label><Input type="number" min="1" step="0.01" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} placeholder="500.00" /></div>
                {parseFloat(topUpAmount) > 0 && (
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">New Spend Cap</span><span className="font-medium text-primary">${(Number(adAccounts?.find((a: any) => a.id === selectedAccountId)?.spend_cap ?? 0) + parseFloat(topUpAmount)).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Wallet After</span><span className={cn("font-medium", (walletBalance - parseFloat(topUpAmount)) < 0 ? "text-destructive" : "")}>${(walletBalance - parseFloat(topUpAmount)).toLocaleString()}</span></div>
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setTopUpDialogOpen(false)}>Cancel</Button>
                  <Button onClick={() => topUpMutation.mutate()} disabled={!selectedAccountId || !topUpAmount || parseFloat(topUpAmount) <= 0 || topUpMutation.isPending}>
                    {topUpMutation.isPending ? "Processing..." : "Top Up Now"}
                  </Button>
                </DialogFooter>
              </TabsContent>
              <TabsContent value="withdraw" className="space-y-4 pt-2">
                {fetchingWithdrawMeta ? (
                  <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Fetching real-time data...</span></div>
                ) : withdrawMeta ? (
                  <>
                    <div className="flex justify-between items-center text-sm p-3 rounded-lg bg-muted"><span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Wallet</span><span className="font-semibold">${walletBalance.toLocaleString()}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Current Spend Cap</span><span className="font-medium">${withdrawMeta.current_spend_cap.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Amount Spent</span><span className="font-medium">${withdrawMeta.real_amount_spent.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    <div className="flex justify-between text-sm font-semibold"><span className="text-muted-foreground">Max Withdrawable</span><span className="text-primary">${withdrawMeta.max_withdrawable.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    <div className="space-y-2">
                      <Label>Withdraw Amount (USD)</Label>
                      <Input type="number" min="1" max={withdrawMeta.max_withdrawable} step="0.01" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder={`Max $${withdrawMeta.max_withdrawable.toFixed(2)}`} />
                      {parseFloat(withdrawAmount) > withdrawMeta.max_withdrawable && <p className="text-sm text-destructive">Amount exceeds maximum</p>}
                    </div>
                    {parseFloat(withdrawAmount) > 0 && parseFloat(withdrawAmount) <= withdrawMeta.max_withdrawable && (
                      <div className="flex justify-between text-sm"><span className="text-muted-foreground">New Spend Cap</span><span className="font-medium text-primary">${(withdrawMeta.current_spend_cap - parseFloat(withdrawAmount)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    )}
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setTopUpDialogOpen(false)}>Cancel</Button>
                      <Button onClick={() => withdrawMutation.mutate()} disabled={!withdrawAmount || parseFloat(withdrawAmount) <= 0 || !withdrawMeta || parseFloat(withdrawAmount) > withdrawMeta.max_withdrawable || withdrawMutation.isPending} variant="destructive">
                        {withdrawMutation.isPending ? "Processing..." : "Withdraw Now"}
                      </Button>
                    </DialogFooter>
                  </>
                ) : <div className="text-center py-6 text-sm text-muted-foreground">Unable to fetch data.</div>}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
