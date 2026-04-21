import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/MetricCard";
import { Wallet, TrendingDown, TrendingUp, AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format } from "date-fns";
import { toast } from "sonner";

export function AgencyWallet() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [showRequest, setShowRequest] = useState(false);
  const [reqAmount, setReqAmount] = useState("");
  const [reqNote, setReqNote] = useState("");

  const { data: agency } = useQuery({
    queryKey: ["my-agency", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("agencies").select("*").eq("owner_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: wallet } = useQuery({
    queryKey: ["agency-wallet", agency?.id],
    queryFn: async () => {
      const { data } = await supabase.from("agency_wallets").select("*").eq("agency_id", agency!.id).single();
      return data;
    },
    enabled: !!agency?.id,
  });

  const { data: clients } = useQuery({
    queryKey: ["agency-clients", agency?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email").eq("agency_id", agency!.id);
      return data || [];
    },
    enabled: !!agency?.id,
  });

  const { data: transactions } = useQuery({
    queryKey: ["agency-sub-transactions", agency?.id],
    queryFn: async () => {
      const clientIds = clients?.map(c => c.user_id) || [];
      if (!clientIds.length) return [];
      const { data } = await supabase
        .from("transactions")
        .select("*")
        .in("user_id", clientIds)
        .order("created_at", { ascending: false })
        .limit(50);
      return data || [];
    },
    enabled: !!(clients && clients.length > 0),
  });

  const balance = Number(wallet?.balance || 0);
  const totalDeposited = Number(wallet?.total_deposited || 0);
  const totalSpent = totalDeposited - balance;
  const isLowBalance = balance <= 0;

  const handleRequestBalance = async () => {
    const amount = Number(reqAmount);
    if (!amount || amount <= 0) { toast.error("Enter a valid amount"); return; }
    // Create a notification for admins
    const { data: admins } = await supabase.from("user_roles").select("user_id").in("role", ["admin", "superadmin"] as any);
    if (admins && admins.length > 0) {
      const notifications = admins.map((a: any) => ({
        user_id: a.user_id,
        type: "agency_balance_request",
        title: "Agency Balance Request",
        message: `${agency?.name || "Agency"} requested $${amount.toLocaleString()} balance top-up. ${reqNote ? `Note: ${reqNote}` : ""}`,
      }));
      await (supabase as any).from("notifications").insert(notifications);
    }
    toast.success("Balance request sent to admin!");
    setShowRequest(false);
    setReqAmount("");
    setReqNote("");
  };

  return (
    <div className="space-y-6">
      {isLowBalance && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <span className="text-destructive font-semibold text-sm">⚠️ Please top up fast! Due to insufficient limit, your clients are unable to top up.</span>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agency Wallet</h1>
        <Dialog open={showRequest} onOpenChange={setShowRequest}>
          <DialogTrigger asChild>
            <Button><Wallet className="h-4 w-4 mr-2" />Request Balance</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Request Balance from Admin</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Amount (USD)</Label><Input type="number" value={reqAmount} onChange={e => setReqAmount(e.target.value)} placeholder="Enter amount" /></div>
              <div><Label>Note (optional)</Label><Input value={reqNote} onChange={e => setReqNote(e.target.value)} placeholder="Payment reference or note" /></div>
              <Button onClick={handleRequestBalance} className="w-full">Send Request</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Current Balance" value={`$${balance.toLocaleString()}`} icon={Wallet} />
        <MetricCard title="Total Deposited" value={`$${totalDeposited.toLocaleString()}`} icon={TrendingUp} />
        <MetricCard title="Total Spent" value={`$${totalSpent.toLocaleString()}`} icon={TrendingDown} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sub-Client Transactions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Balance After</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!transactions?.length ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No transactions yet</TableCell></TableRow>
              ) : transactions.map(t => {
                const client = clients?.find(c => c.user_id === t.user_id);
                return (
                  <TableRow key={t.id}>
                    <TableCell className="text-sm">{format(new Date(t.created_at), "MMM dd, HH:mm")}</TableCell>
                    <TableCell>{client?.full_name || client?.email || "—"}</TableCell>
                    <TableCell className="capitalize">{t.type.replace(/_/g, " ")}</TableCell>
                    <TableCell className={t.type === "top_up" ? "text-green-600" : "text-destructive"}>
                      {t.type === "top_up" ? "+" : "-"}${Number(t.amount).toLocaleString()}
                    </TableCell>
                    <TableCell>${Number(t.balance_after || 0).toLocaleString()}</TableCell>
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
