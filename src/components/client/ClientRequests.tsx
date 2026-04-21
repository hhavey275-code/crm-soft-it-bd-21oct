import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { format } from "date-fns";

export function ClientRequests() {
  const { user } = useAuth();

  const { data: adRequests = [] } = useQuery({
    queryKey: ["client-ad-requests", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ad_account_requests")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: bmRequests = [] } = useQuery({
    queryKey: ["client-bm-requests", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("bm_access_requests")
        .select("*, ad_accounts(account_name, account_id)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl md:text-2xl font-bold">My Requests</h1>
      <Tabs defaultValue="ad-account">
        <TabsList>
          <TabsTrigger value="ad-account">Ad Account Requests</TabsTrigger>
          <TabsTrigger value="bm-access">BM Access Requests</TabsTrigger>
        </TabsList>

        <TabsContent value="ad-account">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>BM ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adRequests.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No ad account requests yet</TableCell></TableRow>
                  ) : adRequests.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.account_name}</TableCell>
                      <TableCell className="text-sm">{r.email}</TableCell>
                      <TableCell className="text-sm font-mono">{r.business_manager_id}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bm-access">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ad Account</TableHead>
                    <TableHead>BM Name</TableHead>
                    <TableHead>BM ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bmRequests.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No BM access requests yet</TableCell></TableRow>
                  ) : bmRequests.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.ad_accounts?.account_name || "—"}</div>
                        {r.ad_accounts?.account_id && <div className="text-xs text-muted-foreground font-mono">{r.ad_accounts.account_id.replace(/^act_/, '')}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{r.bm_name}</TableCell>
                      <TableCell className="text-sm font-mono">{r.bm_id}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
