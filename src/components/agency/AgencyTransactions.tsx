import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

export function AgencyTransactions() {
  const { user } = useAuth();

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

  const { data: transactions, isLoading } = useQuery({
    queryKey: ["agency-all-transactions", agency?.id],
    queryFn: async () => {
      const clientIds = clients?.map(c => c.user_id) || [];
      if (!clientIds.length) return [];
      const { data } = await supabase
        .from("transactions")
        .select("*")
        .in("user_id", clientIds)
        .order("created_at", { ascending: false })
        .limit(200);
      return data || [];
    },
    enabled: !!(clients && clients.length > 0),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Transactions</h1>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Balance After</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : !transactions?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No transactions</TableCell></TableRow>
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
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{t.description || "—"}</TableCell>
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
