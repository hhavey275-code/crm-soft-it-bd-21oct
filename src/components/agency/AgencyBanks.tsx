import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Building2 } from "lucide-react";

export function AgencyBanks() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ bank_name: "", account_name: "", account_number: "", branch: "", telegram_group_id: "" });

  const { data: banks, isLoading } = useQuery({
    queryKey: ["agency-banks", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any).from("bank_accounts").select("*").eq("seller_id", user!.id).order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user,
  });

  const handleAdd = async () => {
    if (!form.bank_name || !form.account_name || !form.account_number) {
      toast.error("Fill required fields");
      return;
    }
    const { error } = await (supabase as any).from("bank_accounts").insert({
      bank_name: form.bank_name,
      account_name: form.account_name,
      account_number: form.account_number,
      branch: form.branch || null,
      telegram_group_id: form.telegram_group_id || null,
      seller_id: user!.id,
      status: "active",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Bank added!");
    setShowAdd(false);
    setForm({ bank_name: "", account_name: "", account_number: "", branch: "", telegram_group_id: "" });
    qc.invalidateQueries({ queryKey: ["agency-banks"] });
  };

  const toggleStatus = async (bankId: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    const { error } = await (supabase as any).from("bank_accounts").update({ status: newStatus }).eq("id", bankId);
    if (error) { toast.error(error.message); return; }
    toast.success(`Bank ${newStatus}`);
    qc.invalidateQueries({ queryKey: ["agency-banks"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Banks</h1>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Add Bank</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Bank Account</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Bank Name *</Label><Input value={form.bank_name} onChange={e => setForm(p => ({ ...p, bank_name: e.target.value }))} /></div>
              <div><Label>Account Name *</Label><Input value={form.account_name} onChange={e => setForm(p => ({ ...p, account_name: e.target.value }))} /></div>
              <div><Label>Account Number *</Label><Input value={form.account_number} onChange={e => setForm(p => ({ ...p, account_number: e.target.value }))} /></div>
              <div><Label>Branch</Label><Input value={form.branch} onChange={e => setForm(p => ({ ...p, branch: e.target.value }))} /></div>
              <div><Label>Telegram Group ID</Label><Input value={form.telegram_group_id} onChange={e => setForm(p => ({ ...p, telegram_group_id: e.target.value }))} placeholder="-100xxxxxxxxxx" /></div>
              <Button onClick={handleAdd} className="w-full">Add Bank</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bank</TableHead>
                <TableHead>Account Name</TableHead>
                <TableHead>Account Number</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : !banks?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No banks added yet</TableCell></TableRow>
              ) : banks.map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.bank_name}</TableCell>
                  <TableCell>{b.account_name}</TableCell>
                  <TableCell className="font-mono text-sm">{b.account_number}</TableCell>
                  <TableCell>{b.branch || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={b.status === "active" ? "default" : "destructive"}>{b.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => toggleStatus(b.id, b.status)}>
                      {b.status === "active" ? "Disable" : "Enable"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}