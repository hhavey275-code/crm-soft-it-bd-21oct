import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpDown, Wallet, Layers } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface Row {
  userId: string;
  name: string;
  subtitle: string;
  email: string;
  status: string;
  balance: number;
}

const fmt = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function WalletBalancesPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [sortAsc, setSortAsc] = useState(false);
  const [sortAscSecondary, setSortAscSecondary] = useState(false);

  const { data: wallets } = useQuery({
    queryKey: ["admin-all-wallets"],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("user_id, balance");
      return (data as any[]) ?? [];
    },
  });

  const { data: secondaryWallets } = useQuery({
    queryKey: ["admin-all-secondary-wallets"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("secondary_wallets").select("user_id, balance");
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

  const profileMap = useMemo(() => {
    const map: Record<string, any> = {};
    (profiles ?? []).forEach((p: any) => { map[p.user_id] = p; });
    return map;
  }, [profiles]);

  const buildRows = (list: any[] | undefined, asc: boolean): Row[] => {
    if (!list?.length || !profiles?.length) return [];
    const rows = list.map((w: any) => {
      const p = profileMap[w.user_id];
      const company = p?.company?.trim();
      const fullName = p?.full_name?.trim();
      return {
        userId: w.user_id,
        name: company || fullName || p?.email || "Unknown",
        subtitle: company && fullName ? fullName : (p?.email || ""),
        email: p?.email || "",
        status: p?.status || "unknown",
        balance: Number(w.balance) || 0,
      };
    });
    rows.sort((a, b) => (asc ? a.balance - b.balance : b.balance - a.balance));
    return rows;
  };

  const rows = useMemo(() => buildRows(wallets, sortAsc), [wallets, profileMap, sortAsc, profiles]);
  const secRows = useMemo(() => buildRows(secondaryWallets, sortAscSecondary), [secondaryWallets, profileMap, sortAscSecondary, profiles]);

  const sum = (list: Row[]) => list.reduce((s, r) => s + r.balance, 0);
  const advance = (list: Row[]) => list.filter(r => r.balance > 0).reduce((s, r) => s + r.balance, 0);
  const due = (list: Row[]) => list.filter(r => r.balance < 0).reduce((s, r) => s + r.balance, 0);

  const mainTotal = sum(rows);
  const secTotal = sum(secRows);

  const renderList = (list: Row[], label: string, asc: boolean, toggle: () => void, accent: string) => (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            {label === "Secondary Wallet" ? <Layers className={`h-4 w-4 ${accent}`} /> : <Wallet className={`h-4 w-4 ${accent}`} />}
            {label}
          </span>
          <Button variant="ghost" size="sm" onClick={toggle} className="text-xs gap-1">
            <ArrowUpDown className="h-3.5 w-3.5" />
            {asc ? "Low → High" : "High → Low"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border p-2">
            <p className="text-[11px] text-muted-foreground">Total</p>
            <p className="text-sm font-bold">{fmt(sum(list))}</p>
          </div>
          <div className="rounded-md border p-2">
            <p className="text-[11px] text-muted-foreground">Advance</p>
            <p className="text-sm font-bold text-emerald-600">{fmt(advance(list))}</p>
          </div>
          <div className="rounded-md border p-2">
            <p className="text-[11px] text-muted-foreground">Due</p>
            <p className="text-sm font-bold text-destructive">{fmt(due(list))}</p>
          </div>
        </div>

        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No wallet data</p>
        ) : isMobile ? (
          <div className="space-y-2">
            {list.map((row, i) => (
              <button
                type="button"
                key={row.userId}
                onClick={() => navigate({ to: "/clients/$id", params: { id: row.userId } })}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg border text-left hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-center h-7 w-7 rounded-full bg-muted text-xs font-bold flex-shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{row.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{row.subtitle}</p>
                </div>
                <p className={`text-sm font-bold ${row.balance > 0 ? "text-emerald-600" : row.balance < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                  {fmt(row.balance)}
                </p>
              </button>
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
                <TableHead className="text-right">Balance / Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((row, i) => (
                <TableRow
                  key={row.userId}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate({ to: "/clients/$id", params: { id: row.userId } })}
                >
                  <TableCell className="font-medium">{i + 1}</TableCell>
                  <TableCell className="font-medium">
                    <div>{row.name}</div>
                    {row.subtitle && row.subtitle !== row.email && (
                      <div className="text-xs text-muted-foreground font-normal">{row.subtitle}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.email}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${row.status === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                      {row.status}
                    </span>
                  </TableCell>
                  <TableCell className={`text-right font-bold ${row.balance > 0 ? "text-emerald-600" : row.balance < 0 ? "text-destructive" : ""}`}>
                    {fmt(row.balance)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          Client Wallet Balances
        </h1>

        <Card>
          <CardContent className="py-3">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="text-xs text-muted-foreground">Total Platform Balance</p>
                <p className="text-lg font-bold">{fmt(mainTotal + secTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Main Wallets</p>
                <p className="text-lg font-bold">{fmt(mainTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Secondary Wallets</p>
                <p className="text-lg font-bold text-fuchsia-600">{fmt(secTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Clients</p>
                <p className="text-lg font-bold">{rows.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {renderList(rows, "Main Wallet", sortAsc, () => setSortAsc(!sortAsc), "text-emerald-600")}
        {renderList(secRows, "Secondary Wallet", sortAscSecondary, () => setSortAscSecondary(!sortAscSecondary), "text-fuchsia-600")}
      </div>
    </DashboardLayout>
  );
}
