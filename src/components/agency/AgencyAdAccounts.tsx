import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SpendProgressBar } from "@/components/SpendProgressBar";
import { InactiveBadge } from "@/components/InactiveBadge";

export function AgencyAdAccounts() {
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

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["agency-ad-accounts", agency?.id],
    queryFn: async () => {
      const clientIds = clients?.map(c => c.user_id) || [];
      if (!clientIds.length) return [];
      const { data: assignments } = await supabase
        .from("user_ad_accounts")
        .select("ad_account_id, user_id")
        .in("user_id", clientIds);
      if (!assignments?.length) return [];
      const accIds = assignments.map(a => a.ad_account_id);
      const { data: accs } = await supabase
        .from("ad_accounts")
        .select("*")
        .in("id", accIds);
      const { data: ins } = await supabase
        .from("ad_account_insights")
        .select("ad_account_id, last_spend_date")
        .in("ad_account_id", accIds);
      const insMap = new Map<string, string | null>();
      (ins || []).forEach((r: any) => insMap.set(r.ad_account_id, r.last_spend_date));
      return (accs || []).map(a => ({
        ...a,
        last_spend_date: insMap.get(a.id) ?? null,
        assigned_to: clients?.find(c => c.user_id === assignments.find(x => x.ad_account_id === a.id)?.user_id),
      }));
    },
    enabled: !!(clients && clients.length > 0),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Ad Accounts</h1>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Spend / Cap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : !accounts?.length ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No ad accounts</TableCell></TableRow>
              ) : accounts.map(a => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{a.account_name}</p>
                      <p className="text-xs text-muted-foreground">{a.account_id}</p>
                      <div className="mt-1">
                        <InactiveBadge lastSpendDate={(a as any).last_spend_date} fallbackDate={a.created_at} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="capitalize">{a.platform}</TableCell>
                  <TableCell>{(a as any).assigned_to?.full_name || (a as any).assigned_to?.email || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === "active" ? "default" : "secondary"}>{a.status}</Badge>
                  </TableCell>
                  <TableCell className="w-48">
                    <SpendProgressBar amountSpent={a.amount_spent} spendCap={a.spend_cap} />
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
