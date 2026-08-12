import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { format } from "date-fns";

export function AgencyTopUp() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: agency } = useQuery({
    queryKey: ["my-agency", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("agencies").select("id").eq("owner_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: clients } = useQuery({
    queryKey: ["agency-clients-ids", agency?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email").eq("agency_id", agency!.id);
      return data || [];
    },
    enabled: !!agency?.id,
  });

  const { data: requests, isLoading } = useQuery({
    queryKey: ["agency-topup-requests", agency?.id],
    queryFn: async () => {
      const clientIds = clients?.map(c => c.user_id) || [];
      if (!clientIds.length) return [];
      const { data } = await supabase
        .from("top_up_requests")
        .select("*")
        .in("user_id", clientIds)
        .order("created_at", { ascending: false })
        .limit(100);
      return data || [];
    },
    enabled: !!(clients && clients.length > 0),
  });

  const handleApprove = async (requestId: string, userId: string, amount: number) => {
    // Check agency wallet
    const { data: agencyWallet } = await supabase
      .from("agency_wallets")
      .select("balance")
      .eq("agency_id", agency!.id)
      .single();

    if (!agencyWallet || Number(agencyWallet.balance) < amount) {
      toast.error("Insufficient agency wallet balance");
      return;
    }

    // Atomic guard: only approve if still pending (prevents double-credit with auto-verify)
    const { data: updatedRows, error: updateErr } = await supabase
      .from("top_up_requests")
      .update({ status: "approved", reviewed_by: user!.id })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("id");
    if (updateErr) { toast.error(updateErr.message); return; }
    if (!updatedRows?.length) {
      toast.error("Already processed (auto-verified or by another admin). Refresh the page.");
      qc.invalidateQueries({ queryKey: ["agency-topup-requests"] });
      return;
    }

    // Add to client wallet — atomic RPC (ledger + balance in one transaction).
    const { data: creditRes, error: creditErr } = await (supabase as any).rpc("credit_wallet_for_payment", {
      p_user_id: userId,
      p_amount: amount,
      p_wallet_kind: "primary",
      p_reference_id: requestId,
      p_description: "Top-up approved by agency",
      p_processed_by: user!.id,
    });
    if (creditErr || (creditRes && creditRes.success === false)) {
      await supabase.from("top_up_requests").update({ status: "pending" }).eq("id", requestId).eq("status", "approved");
      toast.error(creditErr?.message || creditRes?.error || "Wallet credit failed — approval rolled back");
      return;
    }

    // Deduct from agency wallet
    const newAgencyBalance = Number(agencyWallet.balance) - amount;
    await supabase.from("agency_wallets").update({ balance: newAgencyBalance }).eq("agency_id", agency!.id);


    toast.success("Top-up approved");
    qc.invalidateQueries({ queryKey: ["agency-topup-requests"] });
    qc.invalidateQueries({ queryKey: ["agency-wallet"] });
  };

  const handleReject = async (requestId: string) => {
    const { data: updatedRows, error } = await supabase
      .from("top_up_requests")
      .update({ status: "rejected", reviewed_by: user!.id })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("id");
    if (error) { toast.error(error.message); return; }
    if (!updatedRows?.length) {
      toast.error("Already processed. Refresh the page.");
      qc.invalidateQueries({ queryKey: ["agency-topup-requests"] });
      return;
    }
    toast.success("Top-up rejected");
    qc.invalidateQueries({ queryKey: ["agency-topup-requests"] });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Top-Up Requests</h1>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : !requests?.length ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No requests</TableCell></TableRow>
              ) : requests.map(r => {
                const client = clients?.find(c => c.user_id === r.user_id);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{format(new Date(r.created_at), "MMM d, hh:mm a")}</TableCell>
                    <TableCell>{client?.full_name || client?.email || "—"}</TableCell>
                    <TableCell className="font-semibold">${Number(r.amount).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "approved" ? "default" : r.status === "pending" ? "secondary" : "destructive"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.status === "pending" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="default" className="h-7" onClick={() => handleApprove(r.id, r.user_id, Number(r.amount))}>
                            Approve
                          </Button>
                          <Button size="sm" variant="destructive" className="h-7" onClick={() => handleReject(r.id)}>
                            Reject
                          </Button>
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
    </div>
  );
}
