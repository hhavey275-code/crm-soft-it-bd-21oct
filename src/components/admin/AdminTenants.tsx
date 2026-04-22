import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Copy, Ban, CheckCircle, Landmark, Trash2, ExternalLink, Eye } from "lucide-react";
import { format } from "date-fns";

export function AdminTenants() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTenant, setDeleteTenant] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [newTenant, setNewTenant] = useState({ name: "", domain: "", subscription_type: "subscription_only", subscription_fee: 0, system_limit: "", usd_rate: 120 });

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ["tenants"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("tenants").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["tenant-payments"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("tenant_payments").select("*, tenants(name, domain)").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const insert: any = {
        name: newTenant.name,
        domain: newTenant.domain,
        subscription_type: newTenant.subscription_type,
        subscription_fee: newTenant.subscription_fee,
        usd_rate: newTenant.usd_rate,
        status: "pending",
      };
      if (newTenant.subscription_type === "subscription_with_limit" && newTenant.system_limit) {
        insert.system_limit = Number(newTenant.system_limit);
      }
      const { error } = await (supabase as any).from("tenants").insert(insert);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      setAddOpen(false);
      setNewTenant({ name: "", domain: "", subscription_type: "subscription_only", subscription_fee: 0, system_limit: "", usd_rate: 120 });
      toast.success("Tenant added");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Delete related data first
      await (supabase as any).from("tenant_banks").delete().eq("tenant_id", id);
      await (supabase as any).from("tenant_payments").delete().eq("tenant_id", id);
      const { error } = await (supabase as any).from("tenants").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      setDeleteOpen(false);
      setDeleteConfirm("");
      toast.success("Tenant deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleStatus = async (tenant: any) => {
    const newStatus = tenant.status === "active" ? "frozen" : "active";
    await (supabase as any).from("tenants").update({ status: newStatus }).eq("id", tenant.id);
    queryClient.invalidateQueries({ queryKey: ["tenants"] });
    toast.success(`Tenant ${newStatus === "active" ? "activated" : "frozen"}`);
  };

  const copyApiKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast.success("API key copied");
  };

  const statusColor = (s: string) => {
    if (s === "active") return "default" as const;
    if (s === "frozen") return "destructive" as const;
    return "secondary" as const;
  };

  const pendingPayments = payments.filter((p: any) => p.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Tenant Management</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Manage licensed CRM instances</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Add Tenant</Button>
          </DialogTrigger>
          <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add New Tenant</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Name</Label><Input value={newTenant.name} onChange={e => setNewTenant(p => ({ ...p, name: e.target.value }))} placeholder="Client company name" /></div>
              <div><Label>Domain</Label><Input value={newTenant.domain} onChange={e => setNewTenant(p => ({ ...p, domain: e.target.value }))} placeholder="app.example.com" /></div>
              <div>
                <Label>Subscription Type</Label>
                <Select value={newTenant.subscription_type} onValueChange={v => setNewTenant(p => ({ ...p, subscription_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="subscription_only">Subscription Only (Unlimited)</SelectItem>
                    <SelectItem value="subscription_with_limit">Subscription + System Limit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Monthly Fee (৳)</Label><Input type="number" value={newTenant.subscription_fee} onChange={e => setNewTenant(p => ({ ...p, subscription_fee: Number(e.target.value) }))} /></div>
                <div><Label>USD Rate (৳)</Label><Input type="number" value={newTenant.usd_rate} onChange={e => setNewTenant(p => ({ ...p, usd_rate: Number(e.target.value) }))} /></div>
              </div>
              {newTenant.subscription_type === "subscription_with_limit" && (
                <div><Label>Initial System Limit ($)</Label><Input type="number" value={newTenant.system_limit} onChange={e => setNewTenant(p => ({ ...p, system_limit: e.target.value }))} placeholder="e.g. 5000" /></div>
              )}
              <Button className="w-full" onClick={() => addMutation.mutate()} disabled={!newTenant.name || !newTenant.domain || addMutation.isPending}>
                {addMutation.isPending ? "Adding..." : "Add Tenant"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Pending Payments Alert */}
      {pendingPayments.length > 0 && (
        <Card className="border-orange-500/50 bg-orange-500/5">
          <CardContent className="p-3 sm:p-4">
            <p className="text-sm font-medium text-orange-600 dark:text-orange-400">
              ⏳ {pendingPayments.length} pending payment(s)
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tenant Cards - Mobile Optimized */}
      <div className="space-y-3">
        {isLoading ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Loading...</CardContent></Card>
        ) : tenants.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">No tenants yet</CardContent></Card>
        ) : tenants.map((t: any) => (
          <Card
            key={t.id}
            className="overflow-hidden cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all"
            onClick={() => navigate(`/tenants/${t.id}`)}
          >
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-sm sm:text-base truncate">{t.name}</h3>
                    <Badge variant={statusColor(t.status)} className="text-[10px]">{t.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{t.domain}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/tenants/${t.id}`)} title="View Details">
                    <Eye className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyApiKey(t.api_key)} title="Copy API Key">
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleStatus(t)}>
                    {t.status === "active" ? <Ban className="h-3 w-3 text-destructive" /> : <CheckCircle className="h-3 w-3 text-green-500" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setDeleteTenant(t); setDeleteOpen(true); }}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                <div className="bg-muted/50 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground">Type</p>
                  <p className="text-xs font-medium">{t.subscription_type === "subscription_with_limit" ? "Sub + Limit" : "Sub Only"}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground">Fee</p>
                  <p className="text-xs font-medium">৳{Number(t.subscription_fee || 0).toLocaleString()}/mo</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground">USD Rate</p>
                  <p className="text-xs font-medium">৳{Number(t.usd_rate || 0)}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground">
                    {t.subscription_type === "subscription_with_limit" ? "Used / Limit" : "Used"}
                  </p>
                  <p className="text-xs font-medium">
                    ${Number(t.total_used || 0).toLocaleString()}
                    {t.subscription_type === "subscription_with_limit" ? ` / $${Number(t.system_limit || 0).toLocaleString()}` : ""}
                  </p>
                </div>
              </div>

              {/* Subscription date */}
              {t.subscription_paid_until && (
                <p className="text-[10px] text-muted-foreground mt-2">
                  Paid until: {format(new Date(t.subscription_paid_until), "dd MMM yyyy")}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Payment History */}
      {payments.length > 0 && (
        <Card>
          <CardContent className="p-3 sm:p-4">
            <h3 className="font-semibold text-sm mb-3">Recent Payments ({payments.length})</h3>
            <div className="space-y-2">
              {payments.slice(0, 20).map((p: any) => (
                <div key={p.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2 rounded-lg bg-muted/30 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-xs">{p.tenants?.name || "—"}</span>
                    <Badge variant="outline" className="text-[10px]">{p.payment_type}</Badge>
                    <Badge variant={p.status === "approved" ? "default" : p.status === "rejected" ? "destructive" : "secondary"} className="text-[10px]">{p.status}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>৳{Number(p.amount).toLocaleString()}</span>
                    {p.limit_amount && <span>(${Number(p.limit_amount).toLocaleString()})</span>}
                    <span>{format(new Date(p.created_at), "dd MMM")}</span>
                    {p.proof_url && (
                      <a href={p.proof_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Proof</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) setDeleteConfirm(""); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Delete Tenant: {deleteTenant?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              এটা permanently delete হবে। Tenant এর সকল payments এবং bank assignments ও মুছে যাবে।
            </p>
            <div>
              <Label>Type <strong>DELETE</strong> to confirm</Label>
              <Input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder="DELETE" />
            </div>
            <Button
              variant="destructive"
              className="w-full"
              disabled={deleteConfirm !== "DELETE" || deleteMutation.isPending}
              onClick={() => deleteTenant && deleteMutation.mutate(deleteTenant.id)}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Tenant"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
