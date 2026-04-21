import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useState } from "react";
import { Check, X, Search, Trash2, AlertTriangle } from "lucide-react";

export function AgencyClients() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [deleteDialog, setDeleteDialog] = useState<any>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const { data: agency } = useQuery({
    queryKey: ["my-agency", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("agencies").select("*").eq("owner_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: clients, isLoading } = useQuery({
    queryKey: ["agency-clients", agency?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, status, company, phone, usd_rate, created_at")
        .eq("agency_id", agency!.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!agency?.id,
  });

  const filtered = clients?.filter(c =>
    !search || c.full_name?.toLowerCase().includes(search.toLowerCase()) || c.email?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const updateStatus = async (userId: string, status: string) => {
    const { error } = await supabase.from("profiles").update({ status } as any).eq("user_id", userId);
    if (error) { toast.error(error.message); return; }
    toast.success(`Client ${status}`);
    qc.invalidateQueries({ queryKey: ["agency-clients"] });
  };

  const updateRate = async (userId: string, rate: string) => {
    const { error } = await supabase.from("profiles").update({ usd_rate: Number(rate) || null } as any).eq("user_id", userId);
    if (error) { toast.error(error.message); return; }
    toast.success("USD rate updated");
    qc.invalidateQueries({ queryKey: ["agency-clients"] });
  };

  const deleteClientMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await supabase.functions.invoke("delete-client", { body: { target_user_id: userId } });
      if (res.error) throw new Error(res.error.message || "Failed to delete");
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: () => {
      toast.success("Client permanently deleted!");
      setDeleteDialog(null);
      setDeleteConfirmText("");
      qc.invalidateQueries({ queryKey: ["agency-clients"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Clients</h1>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>USD Rate</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : !filtered.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No clients found</TableCell></TableRow>
              ) : filtered.map(c => (
                <TableRow key={c.user_id}>
                  <TableCell className="font-medium">{c.full_name || "—"}</TableCell>
                  <TableCell>{c.email}</TableCell>
                  <TableCell>{c.company || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === "active" ? "default" : c.status === "pending" ? "secondary" : "destructive"}>
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      className="w-20 h-8"
                      defaultValue={c.usd_rate || ""}
                      placeholder="Rate"
                      onBlur={e => {
                        if (e.target.value !== String(c.usd_rate || "")) updateRate(c.user_id, e.target.value);
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {c.status === "pending" && (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 text-green-600" onClick={() => updateStatus(c.user_id, "active")}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => updateStatus(c.user_id, "rejected")}>
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {c.status === "active" && (
                        <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => updateStatus(c.user_id, "suspended")}>
                          Suspend
                        </Button>
                      )}
                      {c.status === "suspended" && (
                        <Button size="sm" variant="ghost" className="h-7 text-green-600" onClick={() => updateStatus(c.user_id, "active")}>
                          Activate
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => setDeleteDialog(c)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!deleteDialog} onOpenChange={() => { setDeleteDialog(null); setDeleteConfirmText(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Permanently Delete Client
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <p>This will <strong>permanently delete</strong> the client <strong>{deleteDialog?.full_name || deleteDialog?.email}</strong> and ALL their data.</p>
              <p className="font-semibold text-destructive mt-3">This action cannot be undone! The client will need to sign up again.</p>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Type <strong>DELETE</strong> to confirm</Label>
            <Input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} placeholder="DELETE" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteDialog(null); setDeleteConfirmText(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== "DELETE" || deleteClientMutation.isPending}
              onClick={() => deleteClientMutation.mutate(deleteDialog.user_id)}
            >
              {deleteClientMutation.isPending ? "Deleting..." : "Permanently Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
