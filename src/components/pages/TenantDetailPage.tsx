import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Copy, Ban, CheckCircle, Trash2, Landmark, Edit, DollarSign,
  CalendarDays, Globe, Key, BarChart3, CreditCard, Building2, TrendingUp, Wallet, SlidersHorizontal
} from "lucide-react";

export default function TenantDetailPage() {
  const { tenantId } = useParams();
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
  const [adjustMode, setAdjustMode] = useState<"increase" | "decrease" | "set">("increase");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  // Tenant
  const { data: tenant, isLoading } = useQuery({
    queryKey: ["tenant-detail", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("tenants").select("*").eq("id", tenantId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!tenantId,
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
      if (!amt || amt <= 0) throw new Error("Enter a valid amount");
      const currentLimit = Number(tenant.system_limit || 0);
      let newLimit = currentLimit;
      let delta = 0;
      if (adjustMode === "increase") { newLimit = currentLimit + amt; delta = amt; }
      else if (adjustMode === "decrease") { newLimit = Math.max(0, currentLimit - amt); delta = -(currentLimit - newLimit); }
      else { newLimit = amt; delta = amt - currentLimit; }

      // Update tenant
      const { error: upErr } = await (supabase as any).from("tenants").update({
        system_limit: newLimit,
        subscription_type: "subscription_with_limit",
      }).eq("id", tenantId);
      if (upErr) throw upErr;

      // Log as a tenant_payment row so it shows in tenant's limit log
      const { error: logErr } = await (supabase as any).from("tenant_payments").insert({
        tenant_id: tenantId,
        amount: 0,
        limit_amount: delta,
        payment_type: "manual_adjustment",
        status: "approved",
        adjustment_reason: adjustReason.trim(),
      });
      if (logErr) throw logErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-payments-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      setAdjustOpen(false);
      setAdjustAmount("");
      setAdjustReason("");
      toast.success("Limit adjusted and logged");
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

  if (!tenant) {
    return (
      <DashboardLayout>
        <div className="text-center py-20 text-muted-foreground">Tenant not found</div>
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
        <Tabs defaultValue="payments">
          <TabsList className={cn(isMobile && "w-full overflow-x-auto flex")}>
            <TabsTrigger value="payments" className={cn(isMobile && "text-xs flex-1")}>Payments</TabsTrigger>
            <TabsTrigger value="banks" className={cn(isMobile && "text-xs flex-1")}>Banks</TabsTrigger>
            <TabsTrigger value="info" className={cn(isMobile && "text-xs flex-1")}>Info</TabsTrigger>
          </TabsList>

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
                  <div><Label>System Limit ($)</Label><Input type="number" value={editData.system_limit || ""} onChange={e => setEditData((p: any) => ({ ...p, system_limit: Number(e.target.value) }))} /></div>
                )}
                <div><Label>Total Used ($)</Label><Input type="number" value={editData.total_used || 0} onChange={e => setEditData((p: any) => ({ ...p, total_used: Number(e.target.value) }))} /></div>
                <Button className="w-full" onClick={() => updateMutation.mutate({
                  name: editData.name,
                  domain: editData.domain,
                  subscription_type: editData.subscription_type,
                  subscription_fee: editData.subscription_fee,
                  usd_rate: editData.usd_rate,
                  system_limit: editData.subscription_type === "subscription_with_limit" ? editData.system_limit : null,
                  total_used: editData.total_used,
                })} disabled={updateMutation.isPending}>
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
            <DialogHeader><DialogTitle>Manually Adjust System Limit</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                বর্তমান limit: <strong>${Number(tenant.system_limit || 0).toLocaleString()}</strong>
              </p>
              <div>
                <Label>Action</Label>
                <Select value={adjustMode} onValueChange={(v: any) => setAdjustMode(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="increase">➕ Increase ($)</SelectItem>
                    <SelectItem value="decrease">➖ Decrease ($)</SelectItem>
                    <SelectItem value="set">🎯 Set Exact Limit ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Amount (USD)</Label>
                <Input type="number" min="0" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} placeholder={adjustMode === "set" ? "New total limit" : "Amount to add/subtract"} />
              </div>
              <div>
                <Label>Reason <span className="text-destructive">*</span></Label>
                <Textarea
                  value={adjustReason}
                  onChange={e => setAdjustReason(e.target.value)}
                  placeholder="যেমনঃ Promotional bonus / Refund adjustment / Compensation for downtime..."
                  rows={3}
                />
                <p className="text-[11px] text-muted-foreground mt-1">এই reason টা tenant-এর limit log-এ দেখাবে।</p>
              </div>
              <Button
                className="w-full"
                variant={adjustMode === "decrease" ? "destructive" : "default"}
                onClick={() => adjustMutation.mutate()}
                disabled={adjustMutation.isPending || !adjustAmount || !adjustReason.trim()}
              >
                {adjustMutation.isPending ? "Saving..." : adjustMode === "increase" ? "Increase Limit" : adjustMode === "decrease" ? "Decrease Limit" : "Set New Limit"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
