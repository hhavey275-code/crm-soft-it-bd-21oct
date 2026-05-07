import { useMemo, useState } from "react";
import { useParams, useNavigate } from "@/lib/router-compat";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Copy, Ban, CheckCircle, Trash2, Landmark, Edit, DollarSign,
  CalendarDays, Globe, Key, BarChart3, CreditCard, Building2, TrendingUp, TrendingDown, Wallet, SlidersHorizontal,
  Users, ShoppingCart, Activity, MonitorSmartphone, RefreshCw, Search, Circle, ExternalLink, Filter, Download
} from "lucide-react";

export default function TenantDetailPage() {
  const params = useParams() as Record<string, string | undefined>;
  const tenantId = useMemo(() => params.tenantId || params.id, [params.id, params.tenantId]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [editOpen, setEditOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [editData, setEditData] = useState<any>(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendMonths, setExtendMonths] = useState("1");
  const [extendMode, setExtendMode] = useState<"extend" | "reduce" | "set">("extend");
  const [manualDate, setManualDate] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustMode, setAdjustMode] = useState<"increase" | "decrease" | "set" | "refund_used">("increase");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [logActionFilter, setLogActionFilter] = useState<"all" | "report-usage" | "refund-usage">("all");
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileValue, setReconcileValue] = useState("");
  const [reconcileReason, setReconcileReason] = useState("Synced to tenant DB value");
  const [editLedgerRow, setEditLedgerRow] = useState<any>(null);
  const [editLedgerAmount, setEditLedgerAmount] = useState("");
  const [editLedgerType, setEditLedgerType] = useState("");
  const [editLedgerReason, setEditLedgerReason] = useState("");

  // Tenant
  const { data: tenant, isLoading, error: tenantError } = useQuery({
    queryKey: ["tenant-detail", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("*")
        .eq("id", tenantId)
        .limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: !!tenantId,
    retry: false,
  });

  // Payments
  const { data: payments = [] } = useQuery({
    queryKey: ["tenant-payments-detail", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("tenant_payments").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!tenantId,
  });

  // Banks
  const { data: allBanks = [] } = useQuery({
    queryKey: ["all-banks-for-tenants"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bank_accounts").select("id, bank_name, account_name, account_number, status").eq("status", "active").order("bank_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: tenantBanks = [] } = useQuery({
    queryKey: ["tenant-banks-detail", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("tenant_banks").select("*, bank_accounts(bank_name, account_name, account_number)").eq("tenant_id", tenantId);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!tenantId,
  });

  const assignedBankIds = tenantBanks.map((tb: any) => tb.bank_account_id);

  // Stats: history snapshots for chart
  const { data: snapshots = [] } = useQuery({
    queryKey: ["tenant-stats-snapshots", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_stats_snapshots")
        .select("snapshot_at, spend_today, accounts_active, accounts_disabled, total_wallet_balance, orders_today")
        .eq("tenant_id", tenantId)
        .order("snapshot_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data as any[]) ?? [];
    },
    enabled: !!tenantId,
  });

  // Tenant-side activity log (system_logs entries created by tenant-webhook)
  const { data: tenantActivity = [] } = useQuery({
    queryKey: ["tenant-activity-log", tenantId, tenant?.name],
    queryFn: async () => {
      if (!tenant?.name) return [];
      const { data, error } = await (supabase as any)
        .from("system_logs")
        .select("id, action, actor_email, created_at, ip_address, details")
        .eq("actor_email", `tenant:${tenant.name}`)
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      return (data as any[]) ?? [];
    },
    enabled: !!tenant?.name,
  });

  // Per-tenant usage audit log — every report-usage / refund-usage call from
  // tenant. Shows ad account, amount, before/after total_used, idempotency,
  // and duplicates so admin can verify limit is calculating correctly.
  const { data: usageLog = [], refetch: refetchUsageLog, isFetching: usageLogFetching } = useQuery({
    queryKey: ["tenant-usage-log", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_usage_report_keys")
        .select("id, idempotency_key, action, amount, source, meta, created_at, before_total_used, after_total_used")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as any[]) ?? [];
    },
    enabled: !!tenantId,
    refetchInterval: 60 * 1000,
  });

  // Unified ledger — every limit/used movement with before/after for both fields.
  const { data: ledger = [], refetch: refetchLedger, isFetching: ledgerFetching } = useQuery({
    queryKey: ["tenant-ledger", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_limit_ledger")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as any[]) ?? [];
    },
    enabled: !!tenantId,
    refetchInterval: 60 * 1000,
  });

  // On-demand refresh: invokes tenant-pull-stats edge function which calls the
  // tenant's webhook (NO Meta API call — tenant returns aggregated data from
  // its own DB, fed by the tenant's existing "Update from Meta" runs).
  const refreshStatsMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("tenant-pull-stats", {
        body: { tenant_id: tenantId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-stats-snapshots", tenantId] });
      toast.success("Stats refreshed from tenant");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to refresh stats"),
  });

  // Update tenant
  const updateMutation = useMutation({
    mutationFn: async (updates: any) => {
      const { error } = await (supabase as any).from("tenants").update(updates).eq("id", tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      setEditOpen(false);
      toast.success("Tenant updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleStatus = async () => {
    if (!tenant) return;
    const newStatus = tenant.status === "active" ? "frozen" : "active";
    await (supabase as any).from("tenants").update({ status: newStatus }).eq("id", tenantId);
    queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
    queryClient.invalidateQueries({ queryKey: ["tenants"] });
    toast.success(`Tenant ${newStatus === "active" ? "activated" : "frozen"}`);
  };

  const toggleBank = async (bankId: string, isAssigned: boolean) => {
    if (isAssigned) {
      await (supabase as any).from("tenant_banks").delete().eq("tenant_id", tenantId).eq("bank_account_id", bankId);
    } else {
      await (supabase as any).from("tenant_banks").insert({ tenant_id: tenantId, bank_account_id: bankId });
    }
    queryClient.invalidateQueries({ queryKey: ["tenant-banks-detail", tenantId] });
    toast.success(isAssigned ? "Bank removed" : "Bank assigned");
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await (supabase as any).from("tenant_banks").delete().eq("tenant_id", tenantId);
      await (supabase as any).from("tenant_payments").delete().eq("tenant_id", tenantId);
      const { error } = await (supabase as any).from("tenants").delete().eq("id", tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      toast.success("Tenant deleted");
      navigate("/tenants");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const extendMutation = useMutation({
    mutationFn: async ({ mode, months, date }: { mode: string; months?: number; date?: string }) => {
      let newDate: Date;
      if (mode === "set" && date) {
        newDate = new Date(date);
      } else {
        const baseDate = tenant.subscription_paid_until && new Date(tenant.subscription_paid_until) > new Date()
          ? new Date(tenant.subscription_paid_until) : new Date();
        const m = months || 1;
        if (mode === "reduce") {
          baseDate.setMonth(baseDate.getMonth() - m);
        } else {
          baseDate.setMonth(baseDate.getMonth() + m);
        }
        newDate = baseDate;
      }
      const { error } = await (supabase as any).from("tenants").update({
        subscription_paid_until: newDate.toISOString(),
        status: newDate > new Date() ? "active" : "frozen",
      }).eq("id", tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      setExtendOpen(false);
      toast.success("Subscription updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const adjustMutation = useMutation({
    mutationFn: async () => {
      if (!tenant) throw new Error("Tenant not loaded");
      if (!adjustReason.trim()) throw new Error("Reason is required");
      const amt = Number(adjustAmount);
      if (!amt || amt < 0) throw new Error("Enter a valid amount");

      if (adjustMode === "refund_used") {
        if (amt <= 0) throw new Error("Enter a valid amount");
        const { data: authData } = await supabase.auth.getUser();
        const { error } = await (supabase as any).rpc("refund_tenant_usage", {
          p_tenant_id: tenantId,
          p_amount: amt,
          p_reason: adjustReason.trim(),
          p_admin: authData?.user?.id ?? null,
        });
        if (error) throw error;
        return;
      }

      const { data: authData } = await supabase.auth.getUser();
      const { error } = await (supabase as any).rpc("adjust_tenant_system_limit", {
        p_tenant_id: tenantId,
        p_mode: adjustMode,
        p_amount: amt,
        p_reason: adjustReason.trim(),
        p_admin: authData?.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-payments-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-usage-log", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-ledger", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      setAdjustOpen(false);
      setAdjustAmount("");
      setAdjustReason("");
      toast.success("Saved and logged in ledger");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Reconcile master total_used to tenant's actual value
  const reconcileMutation = useMutation({
    mutationFn: async () => {
      const v = Number(reconcileValue);
      if (Number.isNaN(v) || v < 0) throw new Error("Enter a valid total used value (>= 0)");
      const { data, error } = await (supabase as any).rpc("reconcile_tenant_total_used", {
        p_tenant_id: tenantId,
        p_new_total_used: v,
        p_reason: reconcileReason.trim() || "manual reconcile",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-usage-log", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      setReconcileOpen(false);
      setReconcileValue("");
      toast.success(`Reconciled: ${Number(data?.before_total_used ?? 0).toFixed(2)} → ${Number(data?.after_total_used ?? 0).toFixed(2)}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const recalcMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("recalculate_tenant_ledger", { p_tenant_id: tenantId });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-ledger", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      toast.success(`Recalculated. Limit $${Number(data?.final_system_limit ?? 0).toFixed(2)}, Used $${Number(data?.final_total_used ?? 0).toFixed(2)}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const editLedgerMutation = useMutation({
    mutationFn: async () => {
      if (!editLedgerRow) throw new Error("No row");
      const amt = Number(editLedgerAmount);
      if (Number.isNaN(amt)) throw new Error("Invalid amount");
      const { error } = await (supabase as any).rpc("update_ledger_entry", {
        p_id: editLedgerRow.id,
        p_amount_delta: amt,
        p_movement_type: editLedgerType,
        p_reason: editLedgerReason || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-ledger", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      setEditLedgerRow(null);
      toast.success("Entry updated and ledger recalculated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteLedgerMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("delete_ledger_entry", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-ledger", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      toast.success("Entry deleted and ledger recalculated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const copyApiKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast.success("API key copied");
  };

  const statusColor = (s: string) => {
    if (s === "active") return "default" as const;
    if (s === "frozen") return "destructive" as const;
    return "secondary" as const;
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  if (tenantError || !tenant) {
    return (
      <DashboardLayout>
        <div className="space-y-3 text-center py-20">
          <p className="text-muted-foreground">Tenant not found</p>
          <Button variant="outline" size="sm" onClick={() => navigate("/tenants")}>
            Back to Tenants
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const isExpired = tenant.subscription_paid_until ? new Date(tenant.subscription_paid_until) < new Date() : true;
  const usagePercent = tenant.system_limit ? Math.min(100, (Number(tenant.total_used) / Number(tenant.system_limit)) * 100) : 0;
  const totalPayments = payments.filter((p: any) => p.status === "approved").reduce((s: number, p: any) => s + Number(p.amount), 0);
  const pendingPayments = payments.filter((p: any) => p.status === "pending");

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6">
        {/* Header - like ClientDetailPage */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/tenants")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-2xl font-bold">{tenant.name}</h1>
                <Badge variant={statusColor(tenant.status)}>{tenant.status}</Badge>
                {isExpired && <Badge variant="destructive" className="text-[10px]">Expired</Badge>}
              </div>
              <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                <Globe className="h-3 w-3" />
                <span>{tenant.domain}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => { setEditData({ ...tenant }); setEditOpen(true); }}>
              <Edit className="h-3 w-3 mr-1" /> Edit
            </Button>
            <Button size="sm" variant="outline" onClick={() => setExtendOpen(true)}>
              <CalendarDays className="h-3 w-3 mr-1" /> Extend
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setAdjustAmount(""); setAdjustReason(""); setAdjustMode("increase"); setAdjustOpen(true); }}>
              <SlidersHorizontal className="h-3 w-3 mr-1" /> Adjust Limit
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBankOpen(true)}>
              <Landmark className="h-3 w-3 mr-1" /> Banks
            </Button>
            <Button size="sm" variant="outline" onClick={toggleStatus}>
              {tenant.status === "active" ? <Ban className="h-3 w-3 mr-1 text-destructive" /> : <CheckCircle className="h-3 w-3 mr-1 text-green-500" />}
              {tenant.status === "active" ? "Freeze" : "Activate"}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3 w-3 mr-1" /> Delete
            </Button>
          </div>
        </div>

        {/* Metric Cards - like ClientDetailPage */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
          <MetricCard
            title="Subscription Fee"
            value={`৳${Number(tenant.subscription_fee || 0).toLocaleString()}/mo`}
            icon={CreditCard}
            iconBg="bg-primary/10"
            iconColor="text-primary"
            size={isMobile ? "xs" : "sm"}
          />
          <MetricCard
            title="USD Rate"
            value={`৳${Number(tenant.usd_rate || 0)}`}
            icon={DollarSign}
            iconBg="bg-primary/10"
            iconColor="text-primary"
            size={isMobile ? "xs" : "sm"}
          />
          <MetricCard
            title="Paid Until"
            value={tenant.subscription_paid_until ? format(new Date(tenant.subscription_paid_until), "dd MMM yy") : "—"}
            icon={CalendarDays}
            iconBg={isExpired ? "bg-destructive/10" : "bg-primary/10"}
            iconColor={isExpired ? "text-destructive" : "text-primary"}
            size={isMobile ? "xs" : "sm"}
          />
          <MetricCard
            title="Total Used"
            value={`$${Number(tenant.total_used || 0).toLocaleString()}`}
            icon={TrendingUp}
            iconBg="bg-primary/10"
            iconColor="text-primary"
            size={isMobile ? "xs" : "sm"}
          />
          <MetricCard
            title={tenant.subscription_type === "subscription_with_limit" ? "System Limit" : "Type"}
            value={tenant.subscription_type === "subscription_with_limit" ? `$${Number(tenant.system_limit || 0).toLocaleString()}` : "Unlimited"}
            icon={BarChart3}
            iconBg="bg-primary/10"
            iconColor="text-primary"
            size={isMobile ? "xs" : "sm"}
          />
          <MetricCard
            title="Total Paid"
            value={`৳${totalPayments.toLocaleString()}`}
            icon={Wallet}
            iconBg="bg-primary/10"
            iconColor="text-primary"
            size={isMobile ? "xs" : "sm"}
          />
        </div>

        {/* Live Stats Section — from tenant heartbeat */}
        <Card className="border-border/60">
          <CardHeader className="p-3 sm:p-4 pb-2">
            <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Live Tenant Stats
                {tenant.stats_updated_at ? (
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Circle className={cn(
                      "h-1.5 w-1.5 fill-current",
                      Date.now() - new Date(tenant.stats_updated_at).getTime() < 10 * 60_000
                        ? "text-green-500" : "text-amber-500"
                    )} />
                    {formatDistanceToNow(new Date(tenant.stats_updated_at), { addSuffix: true })}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">No data yet</Badge>
                )}
              </div>
              <Button
                size="sm"
                variant="default"
                className="h-7"
                disabled={refreshStatsMutation.isPending}
                onClick={() => refreshStatsMutation.mutate()}
              >
                <RefreshCw className={cn("h-3 w-3 mr-1", refreshStatsMutation.isPending && "animate-spin")} />
                {refreshStatsMutation.isPending ? "Pulling…" : "Refresh Stats from Tenant"}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0">
            {!tenant.stats_updated_at ? (
              <p className="text-xs text-muted-foreground py-2">
                এখনো stats pull হয়নি। উপরের <strong>"Refresh Stats from Tenant"</strong> button চাপুন। Tenant এর own database থেকে aggregate করে আনবে — Meta API কে কোনো call হবে না।
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
                <MetricCard
                  title="Ad Accounts"
                  value={Number(tenant.stats_accounts_total || 0)}
                  subtitle={`${tenant.stats_accounts_active || 0} active · ${tenant.stats_accounts_disabled || 0} disabled`}
                  icon={MonitorSmartphone}
                  iconBg="bg-blue-500/10"
                  iconColor="text-blue-600"
                  size={isMobile ? "xs" : "sm"}
                />
                <MetricCard
                  title="Today Spend"
                  value={`$${Number(tenant.stats_spend_today || 0).toLocaleString()}`}
                  subtitle={`Yesterday $${Number(tenant.stats_spend_yesterday || 0).toLocaleString()}`}
                  icon={TrendingUp}
                  iconBg="bg-orange-500/10"
                  iconColor="text-orange-600"
                  size={isMobile ? "xs" : "sm"}
                />
                <MetricCard
                  title="This Month Spend"
                  value={`$${Number(tenant.stats_spend_month || 0).toLocaleString()}`}
                  subtitle={`Lifetime $${Number(tenant.stats_spend_lifetime || 0).toLocaleString()}`}
                  icon={BarChart3}
                  iconBg="bg-violet-500/10"
                  iconColor="text-violet-600"
                  size={isMobile ? "xs" : "sm"}
                />
                <MetricCard
                  title="Wallet Balance"
                  value={`$${Number(tenant.stats_total_wallet || 0).toLocaleString()}`}
                  subtitle="all clients combined"
                  icon={Wallet}
                  iconBg="bg-emerald-500/10"
                  iconColor="text-emerald-600"
                  size={isMobile ? "xs" : "sm"}
                />
                <MetricCard
                  title="Total Clients"
                  value={Number(tenant.stats_total_clients || 0)}
                  subtitle={`${tenant.stats_active_clients_today || 0} active today`}
                  icon={Users}
                  iconBg="bg-cyan-500/10"
                  iconColor="text-cyan-600"
                  size={isMobile ? "xs" : "sm"}
                />
                <MetricCard
                  title="Today Top-Ups"
                  value={`$${Number(tenant.stats_topups_today_amount || 0).toLocaleString()}`}
                  subtitle={`${tenant.stats_topups_today_count || 0} done · ${tenant.stats_topups_pending || 0} pending`}
                  icon={ShoppingCart}
                  iconBg="bg-pink-500/10"
                  iconColor="text-pink-600"
                  size={isMobile ? "xs" : "sm"}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Usage Progress (if limit-based) */}
        {tenant.subscription_type === "subscription_with_limit" && (
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">System Usage</span>
                <span className="text-xs font-medium">{usagePercent.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${usagePercent}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                ${Number(tenant.total_used || 0).toLocaleString()} used of ${Number(tenant.system_limit || 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        )}

        {/* API Key */}
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground shrink-0">API Key:</span>
                <code className="text-xs truncate">{tenant.api_key}</code>
              </div>
              <Button variant="ghost" size="sm" onClick={() => copyApiKey(tenant.api_key)}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Pending Alert */}
        {pendingPayments.length > 0 && (
          <Card className="border-orange-500/50 bg-orange-500/5">
            <CardContent className="p-3 sm:p-4">
              <p className="text-sm font-medium text-orange-600 dark:text-orange-400">
                ⏳ {pendingPayments.length} pending payment(s) — approve from Top-Up Requests page
              </p>
            </CardContent>
          </Card>
        )}

        {/* Tabs - like ClientDetailPage */}
        <Tabs defaultValue="ledger">
          <TabsList className={cn(isMobile && "w-full overflow-x-auto flex")}>
            <TabsTrigger value="ledger" className={cn(isMobile && "text-xs flex-1")}>Ledger</TabsTrigger>
            <TabsTrigger value="payments" className={cn(isMobile && "text-xs flex-1")}>Payments</TabsTrigger>
            <TabsTrigger value="accounts" className={cn(isMobile && "text-xs flex-1")}>Ad Accounts</TabsTrigger>
            <TabsTrigger value="activity" className={cn(isMobile && "text-xs flex-1")}>Activity</TabsTrigger>
            <TabsTrigger value="banks" className={cn(isMobile && "text-xs flex-1")}>Banks</TabsTrigger>
            <TabsTrigger value="usage-log" className={cn(isMobile && "text-xs flex-1")}>Usage Log</TabsTrigger>
            <TabsTrigger value="info" className={cn(isMobile && "text-xs flex-1")}>Info</TabsTrigger>
          </TabsList>

          {/* Ledger Tab — unified, step-by-step, before/after for limit & used */}
          <TabsContent value="ledger" className="space-y-3">
            <Card>
              <CardHeader className="p-3 sm:p-4 pb-2">
                <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    Limit Ledger ({ledger.length})
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => recalcMutation.mutate()} disabled={recalcMutation.isPending} title="Sob entry chronologically recalculate kore correct values bashabe">
                      <RefreshCw className={cn("h-3 w-3 mr-1", recalcMutation.isPending && "animate-spin")} />
                      Recalc
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => refetchLedger()} disabled={ledgerFetching}>
                      <RefreshCw className={cn("h-3 w-3", ledgerFetching && "animate-spin")} />
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-0 space-y-2">
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="rounded-lg p-2.5 bg-blue-500/10 border border-blue-500/20">
                    <p className="text-[10px] uppercase text-muted-foreground">Total Limit</p>
                    <p className="text-base sm:text-lg font-bold text-blue-600 dark:text-blue-400">${Number(tenant.system_limit || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                  </div>
                  <div className="rounded-lg p-2.5 bg-orange-500/10 border border-orange-500/20">
                    <p className="text-[10px] uppercase text-muted-foreground">Used</p>
                    <p className="text-base sm:text-lg font-bold text-orange-600 dark:text-orange-400">${Number(tenant.total_used || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                  </div>
                  <div className="rounded-lg p-2.5 bg-green-500/10 border border-green-500/20">
                    <p className="text-[10px] uppercase text-muted-foreground">Remaining</p>
                    <p className="text-base sm:text-lg font-bold text-green-600 dark:text-green-400">${Math.max(0, Number(tenant.system_limit || 0) - Number(tenant.total_used || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                  </div>
                </div>

                {ledger.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6 border rounded-lg">
                    Kono entry nei akhono. Payment approve / Adjust / Top-up hole ekhane step by step dekhabe.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {ledger.map((row: any) => {
                      const mt = String(row.movement_type || "");
                      const delta = Number(row.amount_delta || 0);
                      const la = row.system_limit_after;
                      const ra = row.remaining_after;
                      const fmt = (v: any) => v == null ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

                      // Classify by movement_type → label, badge color, amount sign/color
                      let label = mt;
                      let badgeClass = "bg-muted text-muted-foreground border-border";
                      let amountClass = "text-muted-foreground";
                      let signStr = "";
                      let IconEl: any = null;

                      if (mt === "usage_topup" || mt === "report-usage") {
                        label = "Consumed";
                        badgeClass = "bg-destructive/10 text-destructive border-destructive/30";
                        amountClass = "text-destructive";
                        signStr = "−";
                        IconEl = TrendingDown;
                      } else if (mt === "usage_refund" || mt === "refund-usage") {
                        label = "Usage Refund";
                        badgeClass = "bg-green-500/10 text-green-600 border-green-500/30";
                        amountClass = "text-green-600";
                        signStr = "+";
                        IconEl = TrendingUp;
                      } else if (mt === "limit_purchase") {
                        label = "Limit Purchase";
                        badgeClass = "bg-green-500/10 text-green-600 border-green-500/30";
                        amountClass = "text-green-600";
                        signStr = "+";
                        IconEl = TrendingUp;
                      } else if (mt === "limit_manual_increase" || (mt === "limit_set" && delta > 0)) {
                        label = "Limit Increase";
                        badgeClass = "bg-blue-500/10 text-blue-600 border-blue-500/30";
                        amountClass = "text-blue-600";
                        signStr = "+";
                        IconEl = TrendingUp;
                      } else if (mt === "limit_manual_decrease" || (mt === "limit_set" && delta < 0)) {
                        label = "Limit Decrease";
                        badgeClass = "bg-destructive/10 text-destructive border-destructive/30";
                        amountClass = "text-destructive";
                        signStr = "−";
                        IconEl = TrendingDown;
                      } else if (mt === "limit_set") {
                        label = "Limit Set";
                        badgeClass = "bg-blue-500/10 text-blue-600 border-blue-500/30";
                        amountClass = "text-foreground";
                      }

                      const remainingNum = ra != null ? Number(ra) : null;
                      const limitNum = la != null ? Number(la) : null;
                      const remainingClass = remainingNum != null && remainingNum < 0
                        ? "text-destructive"
                        : remainingNum != null && limitNum != null && remainingNum < limitNum * 0.2
                          ? "text-yellow-600"
                          : "text-foreground";

                      return (
                        <div key={row.id} className="border rounded-lg p-3 bg-card">
                          <div className="flex items-start justify-between gap-2">
                            <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border inline-flex items-center gap-1", badgeClass)}>
                              {IconEl && <IconEl className="h-3 w-3" />}
                              {label}
                            </span>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                              {format(new Date(row.created_at), "dd MMM, hh:mm a")}
                            </span>
                          </div>
                          <div className={cn("text-lg font-bold mt-1.5", amountClass)}>
                            {signStr}{fmt(Math.abs(delta))}
                          </div>
                          {row.reason && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 italic">{row.reason}</p>
                          )}
                          {(row.meta?.account_name || row.meta?.account_external_id || row.meta?.ad_account_id) && (
                            <div className="mt-1.5 text-[11px]">
                              <span className="text-muted-foreground">Ad Account: </span>
                              <span className="font-medium text-foreground">
                                {row.meta?.account_name || row.meta?.ad_account_id}
                              </span>
                              {row.meta?.account_external_id && (
                                <span className="text-muted-foreground ml-1">
                                  ({row.meta.account_external_id})
                                </span>
                              )}
                            </div>
                          )}
                          <div className="border-t mt-2 pt-2 space-y-1 text-xs">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">System Limit</span>
                              <span className="font-semibold">{fmt(la)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Remaining</span>
                              <span className={cn("font-semibold", remainingClass)}>{fmt(ra)}</span>
                            </div>
                          </div>
                          {row.source && (
                            <p className="text-[9px] text-muted-foreground mt-2 truncate">By: {row.source}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments" className="space-y-3">
            <Card>
              <CardHeader className="p-3 sm:p-4 pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Payment History ({payments.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-0">
                {payments.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">No payments yet</p>
                ) : (
                  <div className="space-y-2">
                    {payments.map((p: any) => (
                      <div key={p.id} className="flex flex-col gap-2 p-3 rounded-lg bg-muted/30 border">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-[10px]">{p.payment_type}</Badge>
                            {p.payment_type !== "manual_adjustment" && (
                              <span className="text-sm font-semibold">৳{Number(p.amount).toLocaleString()}</span>
                            )}
                            {p.limit_amount != null && p.limit_amount !== 0 && (
                              <span className={cn("text-xs font-medium", Number(p.limit_amount) < 0 ? "text-destructive" : "text-muted-foreground")}>
                                {Number(p.limit_amount) > 0 ? "+" : ""}${Number(p.limit_amount).toLocaleString()}
                              </span>
                            )}
                            {p.duration_months && <span className="text-xs text-muted-foreground">{p.duration_months}mo</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={p.status} />
                            <span className="text-xs text-muted-foreground">{format(new Date(p.created_at), "dd MMM yyyy, hh:mm a")}</span>
                            {p.proof_url && (
                              <a href={p.proof_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">Proof</a>
                            )}
                          </div>
                        </div>
                        {p.adjustment_reason && (
                          <p className="text-xs text-muted-foreground italic border-l-2 border-primary/40 pl-2">
                            Reason: {p.adjustment_reason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Banks Tab */}
          <TabsContent value="banks" className="space-y-3">
            <Card>
              <CardHeader className="p-3 sm:p-4 pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Landmark className="h-4 w-4" />
                    Assigned Banks ({tenantBanks.length})
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setBankOpen(true)}>
                    <Edit className="h-3 w-3 mr-1" /> Manage
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-0">
                {tenantBanks.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">No banks assigned</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {tenantBanks.map((tb: any) => (
                      <div key={tb.id} className="p-3 rounded-lg bg-muted/50 border">
                        <p className="font-medium text-sm">{tb.bank_accounts?.bank_name}</p>
                        <p className="text-xs text-muted-foreground">{tb.bank_accounts?.account_name}</p>
                        <p className="text-xs font-mono text-muted-foreground">{tb.bank_accounts?.account_number}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Ad Accounts Tab — top accounts reported by tenant */}
          <TabsContent value="accounts" className="space-y-3">
            <Card>
              <CardHeader className="p-3 sm:p-4 pb-2">
                <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <MonitorSmartphone className="h-4 w-4" />
                    Top Ad Accounts ({Array.isArray(tenant.stats_top_accounts) ? tenant.stats_top_accounts.length : 0})
                  </div>
                  <div className="relative w-40 sm:w-56">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    <Input
                      className="pl-7 h-8 text-xs"
                      placeholder="Search account…"
                      value={accountSearch}
                      onChange={(e) => setAccountSearch(e.target.value)}
                    />
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-0">
                {!Array.isArray(tenant.stats_top_accounts) || tenant.stats_top_accounts.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    Tenant এখনো ad account list পাঠায়নি। heartbeat-এ stats যুক্ত হলে এখানে দেখা যাবে।
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(tenant.stats_top_accounts as any[])
                      .filter((a: any) => {
                        if (!accountSearch.trim()) return true;
                        const q = accountSearch.toLowerCase();
                        return (
                          (a.name || "").toLowerCase().includes(q) ||
                          (a.external_id || "").toLowerCase().includes(q)
                        );
                      })
                      .map((acc: any, idx: number) => (
                        <div key={acc.external_id || idx} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-muted/30 border">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium truncate">{acc.name || "—"}</p>
                              <Badge
                                variant={acc.status === "active" || acc.status === 1 ? "default" : "secondary"}
                                className="text-[10px]"
                              >
                                {String(acc.status ?? "—")}
                              </Badge>
                            </div>
                            <p className="text-[11px] font-mono text-muted-foreground truncate">{acc.external_id || acc.account_id || "—"}</p>
                          </div>
                          <div className="flex items-center gap-3 sm:gap-4 text-xs">
                            <div className="text-right">
                              <p className="text-[10px] text-muted-foreground">Today</p>
                              <p className="font-semibold">${Number(acc.spend_today || 0).toLocaleString()}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] text-muted-foreground">Lifetime</p>
                              <p className="font-semibold">${Number(acc.spend_lifetime || acc.amount_spent || 0).toLocaleString()}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] text-muted-foreground">Balance</p>
                              <p className="font-semibold">${Number(acc.balance || 0).toLocaleString()}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
                {tenant.domain && (
                  <p className="text-[11px] text-muted-foreground mt-3">
                    Top 50 by spend দেখানো হচ্ছে। সম্পূর্ণ list-এর জন্য{" "}
                    <a href={`https://${tenant.domain}`} target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
                      tenant site <ExternalLink className="h-2.5 w-2.5" />
                    </a>{" "}
                    visit করুন।
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Spend trend mini chart */}
            {snapshots.length > 1 && (
              <Card>
                <CardHeader className="p-3 sm:p-4 pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Spend Trend (last {snapshots.length} snapshots)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 sm:p-4 pt-0">
                  {(() => {
                    const series = [...snapshots].reverse();
                    const max = Math.max(1, ...series.map((s: any) => Number(s.spend_today || 0)));
                    return (
                      <div className="flex items-end gap-1 h-24">
                        {series.map((s: any, i: number) => {
                          const v = Number(s.spend_today || 0);
                          const h = (v / max) * 100;
                          return (
                            <div
                              key={i}
                              className="flex-1 bg-primary/70 hover:bg-primary rounded-t transition-colors"
                              style={{ height: `${Math.max(2, h)}%` }}
                              title={`${format(new Date(s.snapshot_at), "dd MMM HH:mm")} — $${v.toLocaleString()}`}
                            />
                          );
                        })}
                      </div>
                    );
                  })()}
                  <p className="text-[10px] text-muted-foreground mt-2">Each bar = today-spend value at that heartbeat.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Activity Tab — system_logs from tenant-webhook */}
          <TabsContent value="activity" className="space-y-3">
            <Card>
              <CardHeader className="p-3 sm:p-4 pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Tenant Activity ({tenantActivity.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-0">
                {tenantActivity.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">No activity logged yet.</p>
                ) : (
                  <div className="space-y-1.5 max-h-[480px] overflow-y-auto">
                    {tenantActivity.map((log: any) => (
                      <div key={log.id} className="flex items-start gap-2 p-2 rounded-md bg-muted/30 border-l-2 border-primary/40">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{log.action}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {format(new Date(log.created_at), "dd MMM yyyy, hh:mm:ss a")}
                            {log.ip_address ? ` · ${log.ip_address}` : ""}
                          </p>
                          {log.details && Object.keys(log.details).length > 0 && (
                            <pre className="text-[10px] text-muted-foreground mt-1 overflow-x-auto whitespace-pre-wrap break-all">
                              {JSON.stringify(log.details, null, 0).slice(0, 240)}
                            </pre>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Usage Log Tab — per-tenant detailed limit consumption audit */}
          <TabsContent value="usage-log" className="space-y-3">
            <Card>
              <CardHeader className="p-3 sm:p-4 pb-2">
                <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    Limit Usage Log
                  </div>
                  <Button size="sm" variant="outline" onClick={() => refetchUsageLog()} disabled={usageLogFetching}>
                    <RefreshCw className={cn("h-3 w-3", usageLogFetching && "animate-spin")} />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-0 space-y-3">
                {/* Top summary: Limit / Used / Remaining */}
                {(() => {
                  const systemLimit = Number(tenant.system_limit || 0);
                  const totalUsed = Number(tenant.total_used || 0);
                  const remaining = Math.max(0, systemLimit - totalUsed);
                  const pct = systemLimit > 0 ? Math.min(100, (totalUsed / systemLimit) * 100) : 0;
                  const isUnlimited = tenant.subscription_type !== "subscription_with_limit";
                  return (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="rounded-lg p-3 bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/20">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Limit</p>
                          <p className="text-lg sm:text-xl font-bold text-blue-600 dark:text-blue-400">
                            {isUnlimited ? "Unlimited" : `$${systemLimit.toLocaleString()}`}
                          </p>
                          <p className="text-[10px] text-muted-foreground">System spend cap</p>
                        </div>
                        <div className="rounded-lg p-3 bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/20">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Used</p>
                          <p className="text-lg sm:text-xl font-bold text-orange-600 dark:text-orange-400">
                            ${totalUsed.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-[10px] text-muted-foreground">{pct.toFixed(1)}% consumed</p>
                        </div>
                        <div className="rounded-lg p-3 bg-gradient-to-br from-green-500/10 to-green-500/5 border border-green-500/20">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Remaining</p>
                          <p className="text-lg sm:text-xl font-bold text-green-600 dark:text-green-400">
                            {isUnlimited ? "∞" : `$${remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                          </p>
                          <p className="text-[10px] text-muted-foreground">Available to spend</p>
                        </div>
                      </div>
                      {!isUnlimited && (
                        <div className="space-y-1">
                          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn(
                                "h-full transition-all",
                                pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-orange-500" : "bg-primary"
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* Reconciliation note */}
                {(() => {
                  const reports = usageLog.filter((r: any) => r.action === "report-usage");
                  const refunds = usageLog.filter((r: any) => r.action === "refund-usage");
                  const totalReported = reports.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
                  const totalRefunded = refunds.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
                  const netConsumed = totalReported - totalRefunded;
                  const tenantTotalUsed = Number(tenant.total_used || 0);
                  const drift = tenantTotalUsed - netConsumed;
                  const driftOk = Math.abs(drift) < 0.5;
                  return (
                    <div className={cn(
                      "rounded-md border p-2 text-[11px] flex flex-wrap items-center gap-x-3 gap-y-1",
                      driftOk ? "border-green-500/30 bg-green-500/5" : "border-destructive/40 bg-destructive/5"
                    )}>
                      <span className="text-muted-foreground">Reported: <strong className="text-foreground">${totalReported.toFixed(2)}</strong></span>
                      <span className="text-muted-foreground">Refunded: <strong className="text-green-600">${totalRefunded.toFixed(2)}</strong></span>
                      <span className="text-muted-foreground">Net: <strong className="text-foreground">${netConsumed.toFixed(2)}</strong></span>
                      <span className={cn("ml-auto font-medium", driftOk ? "text-green-600" : "text-destructive")}>
                        {driftOk ? "✓ Matches tenant total_used" : `Drift Δ ${drift > 0 ? "+" : ""}${drift.toFixed(2)}`}
                      </span>
                    </div>
                  );
                })()}

                {/* Transactions */}
                <div>
                  <p className="text-xs font-semibold mb-2 text-muted-foreground">Transactions ({usageLog.length})</p>
                  {usageLog.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6 border rounded-lg">
                      Kono usage report nei akhono. Tenant top-up korle ekhane dekhabe.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {usageLog.map((row: any) => {
                        const meta = row.meta || {};
                        const accName = meta.account_name || meta.ad_account_name || meta.ad_account_id || "—";
                        const accId = meta.ad_account_id || meta.account_id || "";
                        const before = Number(row.before_total_used ?? 0);
                        const after = Number(row.after_total_used ?? 0);
                        const delta = after - before;
                        const isDup = Math.abs(delta) < 0.001 && Number(row.amount) > 0;
                        const systemLimit = Number(tenant.system_limit || 0);
                        const remainingBefore = Math.max(0, systemLimit - before);
                        const remainingAfter = Math.max(0, systemLimit - after);
                        const isRefund = row.action === "refund-usage";
                        return (
                          <div key={row.id} className={cn(
                            "border rounded-lg p-2.5 text-xs hover:bg-muted/30 transition-colors",
                            isDup && "bg-muted/20 opacity-70"
                          )}>
                            <div className="flex justify-between items-start gap-2 mb-1.5">
                              <div className="min-w-0 flex-1">
                                <div className="font-medium truncate" title={accName}>{accName}</div>
                                {accId && <div className="text-[10px] text-muted-foreground truncate">{accId}</div>}
                              </div>
                              <div className="text-right shrink-0">
                                <div className={cn("font-bold text-sm", isRefund ? "text-green-600" : "text-orange-600")}>
                                  {isRefund ? "-" : "+"}${Number(row.amount).toFixed(2)}
                                </div>
                                <div className="text-[10px] text-muted-foreground">{format(new Date(row.created_at), "dd MMM HH:mm")}</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5 mt-2 pt-2 border-t">
                              <div>
                                <p className="text-[9px] uppercase text-muted-foreground">Limit</p>
                                <p className="font-semibold text-[11px]">${systemLimit.toLocaleString()}</p>
                              </div>
                              <div>
                                <p className="text-[9px] uppercase text-muted-foreground">Used</p>
                                <p className="font-semibold text-[11px]">
                                  ${before.toFixed(0)} → <span className="text-orange-600">${after.toFixed(0)}</span>
                                </p>
                              </div>
                              <div>
                                <p className="text-[9px] uppercase text-muted-foreground">Remaining</p>
                                <p className="font-semibold text-[11px]">
                                  ${remainingBefore.toFixed(0)} → <span className="text-green-600">${remainingAfter.toFixed(0)}</span>
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1 mt-2">
                              <Badge variant={isRefund ? "secondary" : "outline"} className="text-[9px]">
                                {isRefund ? "refund" : "report"}
                              </Badge>
                              {row.source && <Badge variant="outline" className="text-[9px]">{row.source}</Badge>}
                              {isDup && <Badge variant="secondary" className="text-[9px]">duplicate</Badge>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Info Tab */}
          <TabsContent value="info" className="space-y-3">
            <Card>
              <CardHeader className="p-3 sm:p-4 pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Tenant Information
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-[10px] text-muted-foreground mb-1">Name</p>
                    <p className="text-sm font-medium">{tenant.name}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-[10px] text-muted-foreground mb-1">Domain</p>
                    <p className="text-sm font-medium">{tenant.domain}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-[10px] text-muted-foreground mb-1">Subscription Type</p>
                    <p className="text-sm font-medium">{tenant.subscription_type === "subscription_with_limit" ? "Subscription + Limit" : "Subscription Only"}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-[10px] text-muted-foreground mb-1">Status</p>
                    <Badge variant={statusColor(tenant.status)}>{tenant.status}</Badge>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-[10px] text-muted-foreground mb-1">Created</p>
                    <p className="text-sm font-medium">{format(new Date(tenant.created_at), "dd MMM yyyy")}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-[10px] text-muted-foreground mb-1">API Key</p>
                    <div className="flex items-center gap-1">
                      <code className="text-xs truncate">{tenant.api_key.slice(0, 12)}...</code>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyApiKey(tenant.api_key)}>
                        <Copy className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Edit Dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit Tenant</DialogTitle></DialogHeader>
            {editData && (
              <div className="space-y-4">
                <div><Label>Name</Label><Input value={editData.name} onChange={e => setEditData((p: any) => ({ ...p, name: e.target.value }))} /></div>
                <div><Label>Domain</Label><Input value={editData.domain} onChange={e => setEditData((p: any) => ({ ...p, domain: e.target.value }))} /></div>
                <div>
                  <Label>Subscription Type</Label>
                  <Select value={editData.subscription_type} onValueChange={v => setEditData((p: any) => ({ ...p, subscription_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="subscription_only">Subscription Only</SelectItem>
                      <SelectItem value="subscription_with_limit">Subscription + Limit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Monthly Fee (৳)</Label><Input type="number" value={editData.subscription_fee || 0} onChange={e => setEditData((p: any) => ({ ...p, subscription_fee: Number(e.target.value) }))} /></div>
                  <div><Label>USD Rate (৳)</Label><Input type="number" value={editData.usd_rate || 0} onChange={e => setEditData((p: any) => ({ ...p, usd_rate: Number(e.target.value) }))} /></div>
                </div>
                {editData.subscription_type === "subscription_with_limit" && (
                  <div>
                    <Label>System Limit ($)</Label>
                    <Input type="number" value={editData.system_limit || ""} disabled readOnly />
                    <p className="text-[11px] text-muted-foreground mt-1">এই field শুধু "Adjust Limit" বা tenant payment approve থেকে পাল্টাবে — direct edit বন্ধ।</p>
                  </div>
                )}
                <div>
                  <Label>Total Used ($) — Manual Baseline</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editData.total_used ?? 0}
                    onChange={e => setEditData((p: any) => ({ ...p, total_used: e.target.value }))}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    এখানে exact used set করো। Save করলে current value k overwrite kore Usage Log e ekta reconcile entry tairi hobe. Erpor theke ad-account top-up gulo ei baseline er upor jog hobe — ar kono auto/antaze calculation hobe na.
                  </p>
                </div>
                <Button className="w-full" onClick={async () => {
                  const newUsed = Number(editData.total_used);
                  if (Number.isNaN(newUsed) || newUsed < 0) {
                    toast.error("Total Used must be a non-negative number");
                    return;
                  }
                  // 1) Save other tenant fields
                  await updateMutation.mutateAsync({
                    name: editData.name,
                    domain: editData.domain,
                    subscription_type: editData.subscription_type,
                    subscription_fee: editData.subscription_fee,
                    usd_rate: editData.usd_rate,
                  });
                  // 2) Reconcile total_used if changed
                  if (Number(tenant.total_used ?? 0).toFixed(2) !== newUsed.toFixed(2)) {
                    const { error: rpcErr } = await (supabase as any).rpc("reconcile_tenant_total_used", {
                      p_tenant_id: tenantId,
                      p_new_total_used: newUsed,
                      p_reason: "Manual baseline set via Edit Tenant",
                    });
                    if (rpcErr) {
                      toast.error("Used reconcile failed: " + rpcErr.message);
                      return;
                    }
                    toast.success(`Total Used baseline set to $${newUsed.toFixed(2)}`);
                    queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
                    queryClient.invalidateQueries({ queryKey: ["tenant-ledger", tenantId] });
                    queryClient.invalidateQueries({ queryKey: ["tenant-usage-audit", tenantId] });
                  }
                }} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Bank Assignment Dialog */}
        <Dialog open={bankOpen} onOpenChange={setBankOpen}>
          <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Assign Banks</DialogTitle></DialogHeader>
            <p className="text-xs text-muted-foreground">Tenant এই bank গুলোতে payment করতে পারবে</p>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {allBanks.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active banks found</p>
              ) : allBanks.map((bank) => {
                const assigned = assignedBankIds.includes(bank.id);
                return (
                  <div key={bank.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50">
                    <Checkbox checked={assigned} onCheckedChange={() => toggleBank(bank.id, assigned)} />
                    <span className="text-sm">{bank.bank_name} — {bank.account_name} (***{bank.account_number.slice(-4)})</span>
                  </div>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Dialog */}
        <Dialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) setDeleteConfirm(""); }}>
          <DialogContent className="max-w-[95vw] sm:max-w-md">
            <DialogHeader><DialogTitle>Delete Tenant: {tenant.name}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                এটা permanently delete হবে। সকল payments এবং bank assignments ও মুছে যাবে।
              </p>
              <div>
                <Label>Type <strong>DELETE</strong> to confirm</Label>
                <Input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder="DELETE" />
              </div>
              <Button
                variant="destructive"
                className="w-full"
                disabled={deleteConfirm !== "DELETE" || deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete Tenant"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Extend Subscription Dialog */}
        <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
          <DialogContent className="max-w-[95vw] sm:max-w-sm">
            <DialogHeader><DialogTitle>Manage Subscription</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                বর্তমান মেয়াদ: {tenant.subscription_paid_until ? format(new Date(tenant.subscription_paid_until), "dd MMM yyyy") : "None"}
              </p>
              <div>
                <Label>Action</Label>
                <Select value={extendMode} onValueChange={(v: any) => setExtendMode(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="extend">➕ Extend (বাড়ানো)</SelectItem>
                    <SelectItem value="reduce">➖ Reduce (কমানো)</SelectItem>
                    <SelectItem value="set">📅 Set Date (ম্যানুয়াল)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {extendMode !== "set" ? (
                <div>
                  <Label>Months</Label>
                  <Select value={extendMonths} onValueChange={setExtendMonths}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 6, 12].map(m => (
                        <SelectItem key={m} value={String(m)}>{m} month{m > 1 ? "s" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div>
                  <Label>Set Expiry Date</Label>
                  <Input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} />
                </div>
              )}
              <Button
                className="w-full"
                variant={extendMode === "reduce" ? "destructive" : "default"}
                onClick={() => extendMutation.mutate(
                  extendMode === "set"
                    ? { mode: "set", date: manualDate }
                    : { mode: extendMode, months: Number(extendMonths) }
                )}
                disabled={extendMutation.isPending || (extendMode === "set" && !manualDate)}
              >
                {extendMutation.isPending ? "Saving..." : extendMode === "extend" ? `Extend ${extendMonths} Month(s)` : extendMode === "reduce" ? `Reduce ${extendMonths} Month(s)` : "Set Date"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Adjust Limit Dialog */}
        <Dialog open={adjustOpen} onOpenChange={(o) => { setAdjustOpen(o); if (!o) { setAdjustAmount(""); setAdjustReason(""); } }}>
          <DialogContent className="max-w-[95vw] sm:max-w-sm">
            <DialogHeader><DialogTitle>Adjust System Limit / Used</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Limit: <strong>${Number(tenant.system_limit || 0).toLocaleString()}</strong> · Used: <strong>${Number(tenant.total_used || 0).toLocaleString()}</strong>
              </p>
              <div>
                <Label>Action</Label>
                <Select value={adjustMode} onValueChange={(v: any) => setAdjustMode(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="increase">➕ Increase System Limit ($)</SelectItem>
                    <SelectItem value="decrease">➖ Decrease System Limit ($)</SelectItem>
                    <SelectItem value="set">🎯 Set Exact System Limit ($)</SelectItem>
                    <SelectItem value="refund_used">↩️ Refund Used (decreases Used)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Amount (USD)</Label>
                <Input type="number" min="0" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} placeholder={adjustMode === "set" ? "New total limit" : "Amount"} />
              </div>
              <div>
                <Label>Reason <span className="text-destructive">*</span></Label>
                <Textarea
                  value={adjustReason}
                  onChange={e => setAdjustReason(e.target.value)}
                  placeholder="যেমনঃ Promotional bonus / Refund adjustment / Account refund..."
                  rows={3}
                />
                <p className="text-[11px] text-muted-foreground mt-1">Reason টা ledger-এ before/after সহ save হবে।</p>
              </div>
              <Button
                className="w-full"
                variant={adjustMode === "decrease" ? "destructive" : "default"}
                onClick={() => adjustMutation.mutate()}
                disabled={adjustMutation.isPending || !adjustAmount || !adjustReason.trim()}
              >
                {adjustMutation.isPending ? "Saving..." : adjustMode === "increase" ? "Increase Limit" : adjustMode === "decrease" ? "Decrease Limit" : adjustMode === "set" ? "Set New Limit" : "Refund Used"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
