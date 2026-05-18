import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpDown, Wallet, Users } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

export default function WalletBalancesPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [sortAsc, setSortAsc] = useState(false);

  const { data: wallets } = useQuery({
    queryKey: ["admin-all-wallets"],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("user_id, balance");
      return (data as any[]) ?? [];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["admin-profiles-wallets"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email, status, company");
      return (data as any[]) ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => {
    if (!wallets?.length || !profiles?.length) return [];
    const profileMap: Record<string, any> = {};
    profiles.forEach((p: any) => { profileMap[p.user_id] = p; });

    const list = wallets.map((w: any) => ({
      userId: w.user_id,
      name: profileMap[w.user_id]?.full_name || profileMap[w.user_id]?.email || "Unknown",
      email: profileMap[w.user_id]?.email || "",
      status: profileMap[w.user_id]?.status || "unknown",
      balance: Number(w.balance) || 0,
    }));

    list.sort((a: any, b: any) => sortAsc ? a.balance - b.balance : b.balance - a.balance);
    return list;
  }, [wallets, profiles, sortAsc]);

  const totalBalance = rows.reduce((s, r) => s + r.balance, 0);
  const nonZeroCount = rows.filter(r => r.balance > 0).length;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          Client Wallet Balances
        </h1>

        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-6">
              <div>
                <p className="text-xs text-muted-foreground">Total Platform Balance</p>
                <p className="text-lg font-bold">${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Clients with Balance</p>
                <p className="text-lg font-bold">{nonZeroCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Clients</p>
                <p className="text-lg font-bold">{rows.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Wallet Balances</span>
              <Button variant="ghost" size="sm" onClick={() => setSortAsc(!sortAsc)} className="text-xs gap-1">
                <ArrowUpDown className="h-3.5 w-3.5" />
                {sortAsc ? "Low → High" : "High → Low"}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No wallet data</p>
            ) : isMobile ? (
              <div className="space-y-2">
                {rows.map((row, i) => (
                  <div key={row.userId} className="flex items-center gap-3 p-2.5 rounded-lg border">
                    <div className="flex items-center justify-center h-7 w-7 rounded-full bg-muted text-xs font-bold flex-shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{row.name}</p>
                      <p className="text-xs text-muted-foreground">{row.email}</p>
                    </div>
                    <p className={`text-sm font-bold ${row.balance > 0 ? "text-emerald-600" : row.balance < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      ${row.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={row.userId}>
                      <TableCell className="font-medium">{i + 1}</TableCell>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">{row.email}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${row.status === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                          {row.status}
                        </span>
                      </TableCell>
                      <TableCell className={`text-right font-bold ${row.balance > 0 ? "text-emerald-600" : row.balance < 0 ? "text-destructive" : ""}`}>
                        ${row.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
