import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { format } from "date-fns";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImageIcon } from "lucide-react";

export function SellerTopUpApprovals() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  const canApprove = !!(profile as any)?.can_approve_topups;

  const { data: requests, isLoading } = useQuery({
    queryKey: ["seller-topup-approvals", user?.id],
    queryFn: async () => {
      // get my banks
      const { data: banks } = await supabase
        .from("bank_accounts")
        .select("id, bank_name, account_number")
        .eq("seller_id", user!.id);
      const bankIds = (banks || []).map(b => b.id);
      if (!bankIds.length) return { requests: [], banks: [] };
      const { data, error } = await supabase
        .from("top_up_requests")
        .select("*")
        .in("bank_account_id", bankIds)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return { requests: data || [], banks: banks || [] };
    },
    enabled: !!user,
  });

  // fetch client names for display
  const userIds = Array.from(new Set((requests?.requests || []).map((r: any) => r.user_id)));
  const { data: clients } = useQuery({
    queryKey: ["seller-topup-clients", userIds.join(",")],
    queryFn: async () => {
      if (!userIds.length) return [];
      const { data } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", userIds);
      return data || [];
    },
    enabled: userIds.length > 0,
  });

  const handleApprove = async (r: any) => {
    if (!canApprove) { toast.error("Approval not enabled for your account"); return; }
    const { data: updatedRows, error: updateErr } = await supabase
      .from("top_up_requests")
      .update({ status: "approved", reviewed_by: user!.id })
      .eq("id", r.id)
      .eq("status", "pending")
      .select("id");
    if (updateErr) { toast.error(updateErr.message); return; }
    if (!updatedRows?.length) {
      toast.error("Already processed. Refresh the page.");
      qc.invalidateQueries({ queryKey: ["seller-topup-approvals"] });
      return;
    }

    // Credit client wallet + insert transaction. The DB trigger
    // sync_seller_transaction_for_approved_topup will mirror to
    // seller_transactions and forward to Telegram automatically.
    const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", r.user_id).single();
    const newBalance = Number(w?.balance || 0) + Number(r.amount);
    await supabase.from("wallets").update({ balance: newBalance }).eq("user_id", r.user_id);
    await supabase.from("transactions").insert({
      user_id: r.user_id, type: "top_up", amount: r.amount, balance_after: newBalance,
      reference_id: r.id, description: "Top-up approved by seller", processed_by: user!.id,
    });

    toast.success("Top-up approved");
    qc.invalidateQueries({ queryKey: ["seller-topup-approvals"] });
  };

  const handleReject = async (r: any) => {
    if (!canApprove) { toast.error("Approval not enabled for your account"); return; }
    const { data: updatedRows, error } = await supabase
      .from("top_up_requests")
      .update({ status: "rejected", reviewed_by: user!.id })
      .eq("id", r.id)
      .eq("status", "pending")
      .select("id");
    if (error) { toast.error(error.message); return; }
    if (!updatedRows?.length) {
      toast.error("Already processed. Refresh the page.");
      qc.invalidateQueries({ queryKey: ["seller-topup-approvals"] });
      return;
    }
    toast.success("Top-up rejected");
    qc.invalidateQueries({ queryKey: ["seller-topup-approvals"] });
  };

  const list = requests?.requests || [];
  const banks = requests?.banks || [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Top-Up Requests</h1>
        <p className="text-sm text-muted-foreground">
          Requests submitted on your banks{banks.length ? ` (${banks.length})` : ""}.
        </p>
      </div>

      {!canApprove && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 text-sm text-amber-700 dark:text-amber-300">
            Approval is not enabled for your account. Contact admin to allow you to approve top-ups.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>BDT</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Proof</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : !list.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No requests yet.</TableCell></TableRow>
              ) : list.map((r: any) => {
                const c = clients?.find((x: any) => x.user_id === r.user_id);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.created_at), "MMM d, hh:mm a")}</TableCell>
                    <TableCell className="text-sm">{c?.full_name || c?.email || r.user_id.slice(0, 8)}</TableCell>
                    <TableCell className="font-semibold">${Number(r.amount).toLocaleString()}</TableCell>
                    <TableCell>{r.bdt_amount ? `৳${Number(r.bdt_amount).toLocaleString()}` : "—"}</TableCell>
                    <TableCell className="text-xs font-mono">{r.payment_reference || "—"}</TableCell>
                    <TableCell>
                      {r.proof_url ? (
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setProofUrl(r.proof_url)}>
                          <ImageIcon className="h-4 w-4" />
                        </Button>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "approved" ? "default" : r.status === "pending" ? "secondary" : "destructive"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.status === "pending" && canApprove && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="default" className="h-7" onClick={() => handleApprove(r)}>Approve</Button>
                          <Button size="sm" variant="destructive" className="h-7" onClick={() => handleReject(r)}>Reject</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!proofUrl} onOpenChange={(o) => !o && setProofUrl(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Payment Proof</DialogTitle></DialogHeader>
          {proofUrl && <img src={proofUrl} alt="Proof" className="w-full rounded" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
