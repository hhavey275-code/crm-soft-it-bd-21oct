import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import { Wallet } from "lucide-react";

export function AdminWallet() {
  const isMobile = useIsMobile();

  const { data: wallets } = useQuery({
    queryKey: ["admin-all-wallets"],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("*, profiles!inner(full_name, email, company)");
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4 md:space-y-6">
      <h1 className="text-xl md:text-2xl font-bold">All Wallets</h1>

      {isMobile ? (
        <div className="space-y-2.5">
          {wallets?.map((w: any) => (
            <Card key={w.id} className="border border-border/60 shadow-sm">
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                    <Wallet className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold truncate">{w.profiles?.full_name || "—"}</p>
                      <p className="text-sm font-bold text-emerald-600">${Number(w.balance).toLocaleString()}</p>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{w.profiles?.email || "—"}</p>
                    {w.profiles?.company && (
                      <p className="text-[11px] text-muted-foreground">{w.profiles.company}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!wallets || wallets.length === 0) && (
            <p className="text-center text-muted-foreground py-8 text-sm">No wallets found</p>
          )}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Client Balances</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Currency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wallets?.map((w: any) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.profiles?.full_name || "—"}</TableCell>
                    <TableCell>{w.profiles?.email || "—"}</TableCell>
                    <TableCell>{w.profiles?.company || "—"}</TableCell>
                    <TableCell className="text-right font-semibold">${Number(w.balance).toLocaleString()}</TableCell>
                    <TableCell>{w.currency}</TableCell>
                  </TableRow>
                ))}
                {(!wallets || wallets.length === 0) && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No wallets found</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
