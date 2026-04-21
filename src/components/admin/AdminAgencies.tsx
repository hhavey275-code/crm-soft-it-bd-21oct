import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useState } from "react";
import { Plus, DollarSign, Ban, CheckCircle } from "lucide-react";
import { format } from "date-fns";

export function AdminAgencies() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showDeposit, setShowDeposit] = useState<string | null>(null);
  const [showSubscription, setShowSubscription] = useState<string | null>(null);
  const [newAgency, setNewAgency] = useState({ name: "", slug: "", ownerEmail: "", usdRate: "" });
  const [depositAmount, setDepositAmount] = useState("");
  const [subFee, setSubFee] = useState("");
  const [subMonths, setSubMonths] = useState("1");

  const { data: agencies, isLoading } = useQuery({
    queryKey: ["admin-agencies"],
    queryFn: async () => {
      const { data } = await supabase.from("agencies").select("*").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: wallets } = useQuery({
    queryKey: ["admin-agency-wallets"],
    queryFn: async () => {
      const { data } = await supabase.from("agency_wallets").select("*");
      return data || [];
    },
  });

  const handleCreate = async () => {
    if (!newAgency.name || !newAgency.slug || !newAgency.ownerEmail) {
      toast.error("Fill all fields"); return;
    }
    // Find owner by email
    const { data: ownerProfile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("email", newAgency.ownerEmail)
      .single();
    if (!ownerProfile) { toast.error("User not found with that email"); return; }

    const { data: ag, error } = await supabase.from("agencies").insert({
      name: newAgency.name,
      slug: newAgency.slug.toLowerCase().replace(/[^a-z0-9-]/g, ""),
      owner_id: ownerProfile.user_id,
      usd_rate: Number(newAgency.usdRate) || 0,
    } as any).select().single();
    if (error) { toast.error(error.message); return; }

    // Create wallet
    await supabase.from("agency_wallets").insert({ agency_id: ag.id } as any);

    // Update owner role to agency
    await supabase.from("user_roles").update({ role: "agency" } as any).eq("user_id", ownerProfile.user_id);

    toast.success("Agency created!");
    setShowCreate(false);
    setNewAgency({ name: "", slug: "", ownerEmail: "", usdRate: "" });
    qc.invalidateQueries({ queryKey: ["admin-agencies"] });
    qc.invalidateQueries({ queryKey: ["admin-agency-wallets"] });
  };

  const handleDeposit = async () => {
    if (!showDeposit || !depositAmount) return;
    const amount = Number(depositAmount);
    if (amount <= 0) { toast.error("Invalid amount"); return; }

    const wallet = wallets?.find(w => w.agency_id === showDeposit);
    if (!wallet) { toast.error("Wallet not found"); return; }

    const { error } = await supabase.from("agency_wallets").update({
      balance: Number(wallet.balance) + amount,
      total_deposited: Number(wallet.total_deposited) + amount,
    } as any).eq("agency_id", showDeposit);
    if (error) { toast.error(error.message); return; }

    toast.success(`$${amount} deposited to agency wallet`);
    setShowDeposit(null);
    setDepositAmount("");
    qc.invalidateQueries({ queryKey: ["admin-agency-wallets"] });
  };

  const handleSubscription = async () => {
    if (!showSubscription) return;
    const months = Number(subMonths) || 1;
    const fee = Number(subFee) || 0;
    const paidUntil = new Date();
    paidUntil.setMonth(paidUntil.getMonth() + months);

    const { error } = await supabase.from("agencies").update({
      subscription_fee: fee,
      subscription_paid_until: paidUntil.toISOString(),
    } as any).eq("id", showSubscription);
    if (error) { toast.error(error.message); return; }

    toast.success("Subscription updated");
    setShowSubscription(null);
    qc.invalidateQueries({ queryKey: ["admin-agencies"] });
  };

  const toggleStatus = async (agencyId: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "frozen" : "active";
    const { error } = await supabase.from("agencies").update({ status: newStatus } as any).eq("id", agencyId);
    if (error) { toast.error(error.message); return; }
    toast.success(`Agency ${newStatus}`);
    qc.invalidateQueries({ queryKey: ["admin-agencies"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agencies</h1>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Create Agency</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create New Agency</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Agency Name</Label><Input value={newAgency.name} onChange={e => setNewAgency(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>Slug (subdomain)</Label><Input value={newAgency.slug} onChange={e => setNewAgency(p => ({ ...p, slug: e.target.value }))} placeholder="agency-name" /></div>
              <div><Label>Owner Email</Label><Input value={newAgency.ownerEmail} onChange={e => setNewAgency(p => ({ ...p, ownerEmail: e.target.value }))} placeholder="owner@email.com" /></div>
              <div><Label>USD Rate</Label><Input type="number" value={newAgency.usdRate} onChange={e => setNewAgency(p => ({ ...p, usdRate: e.target.value }))} /></div>
              <Button onClick={handleCreate} className="w-full">Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agency</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Wallet Balance</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : !agencies?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No agencies</TableCell></TableRow>
              ) : agencies.map(a => {
                const wallet = wallets?.find(w => w.agency_id === a.id);
                const isExpired = a.subscription_paid_until && new Date(a.subscription_paid_until) < new Date();
                return (
                  <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/agencies/${a.id}`)}>
                    <TableCell className="font-medium text-primary hover:underline">{a.name}</TableCell>
                    <TableCell className="text-muted-foreground">{a.slug}</TableCell>
                    <TableCell>
                      <Badge variant={a.status === "active" ? "default" : "destructive"}>{a.status}</Badge>
                    </TableCell>
                    <TableCell>${Number(wallet?.balance || 0).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <span>${Number(a.subscription_fee || 0)}/mo</span>
                        {a.subscription_paid_until && (
                          <Badge variant={isExpired ? "destructive" : "default"} className="ml-2">
                            {isExpired ? "Expired" : `Until ${format(new Date(a.subscription_paid_until), "MMM dd")}`}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Dialog open={showDeposit === a.id} onOpenChange={open => setShowDeposit(open ? a.id : null)}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline" className="h-7"><DollarSign className="h-3 w-3" /></Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Deposit to {a.name}</DialogTitle></DialogHeader>
                            <div className="space-y-4">
                              <div><Label>Amount (USD)</Label><Input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} /></div>
                              <Button onClick={handleDeposit} className="w-full">Deposit</Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                        <Dialog open={showSubscription === a.id} onOpenChange={open => { setShowSubscription(open ? a.id : null); if (open) { setSubFee(String(a.subscription_fee || "")); } }}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline" className="h-7">Sub</Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Subscription for {a.name}</DialogTitle></DialogHeader>
                            <div className="space-y-4">
                              <div><Label>Monthly Fee (USD)</Label><Input type="number" value={subFee} onChange={e => setSubFee(e.target.value)} /></div>
                              <div><Label>Extend by (months)</Label><Input type="number" value={subMonths} onChange={e => setSubMonths(e.target.value)} /></div>
                              <Button onClick={handleSubscription} className="w-full">Update Subscription</Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => toggleStatus(a.id, a.status)}>
                          {a.status === "active" ? <Ban className="h-3 w-3 text-destructive" /> : <CheckCircle className="h-3 w-3 text-green-600" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
