import { matchesSearch } from "@/lib/searchNormalize";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { InactiveBadge } from "@/components/InactiveBadge";
import { getInactiveDays } from "@/lib/inactiveDays";
import { AlertTriangle, Search, ExternalLink } from "lucide-react";

type Tier = "15" | "30" | "45" | "unknown";

export default function MyUnusedAccountsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tier>("15");
  const [search, setSearch] = useState("");

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["my-unused-accounts", user?.id],
    queryFn: async () => {
      const { data: assigns } = await (supabase as any)
        .from("user_ad_accounts")
        .select("ad_account_id")
        .eq("user_id", user!.id);
      const ids = (assigns ?? []).map((a: any) => a.ad_account_id);
      if (ids.length === 0) return [];
      const [{ data: accs }, { data: ins }] = await Promise.all([
        supabase.from("ad_accounts").select("*, business_managers(name)").in("id", ids),
        supabase.from("ad_account_insights").select("ad_account_id, last_spend_date, balance").in("ad_account_id", ids),
      ]);
      const insMap = new Map<string, any>();
      (ins ?? []).forEach((r: any) => insMap.set(r.ad_account_id, r));
      return (accs ?? []).map((a: any) => ({
        ...a,
        last_spend_date: insMap.get(a.id)?.last_spend_date ?? null,
        balance: insMap.get(a.id)?.balance ?? null,
      }));
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts
      .map((a: any) => ({ ...a, _info: getInactiveDays(a.last_spend_date) }))
      .filter((a: any) => {
        if (tab === "unknown") return a._info.isUnknown;
        if (a._info.isUnknown) return false;
        const minDays = parseInt(tab);
        return a._info.days >= minDays;
      })
      .filter((a: any) => {
        if (!q) return true;
        return (
          matchesSearch(q, a.account_name, a.account_id)
        );
      })
      .sort((a: any, b: any) => b._info.days - a._info.days);
  }, [accounts, tab, search]);

  const counts = useMemo(() => {
    const c = { "15": 0, "30": 0, "45": 0, unknown: 0 };
    accounts.forEach((a: any) => {
      const info = getInactiveDays(a.last_spend_date);
      if (info.isUnknown) { c.unknown++; return; }
      const d = info.days;
      if (d >= 15) c["15"]++;
      if (d >= 30) c["30"]++;
      if (d >= 45) c["45"]++;
    });
    return c;
  }, [accounts]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <h1 className="text-2xl font-bold">My Unused Accounts</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Ad accounts that haven't been used recently. Reactivate them by running campaigns to keep them healthy.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <CardTitle className="text-base">
                Total assigned: <span className="text-primary">{accounts.length}</span>
              </CardTitle>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search account name / ID..."
                  className="pl-8 h-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tier)}>
              <TabsList className="grid w-full grid-cols-4 max-w-2xl">
                <TabsTrigger value="15" className="gap-2">
                  15+ days
                  <Badge variant="secondary" className="h-5 px-1.5 text-xs">{counts["15"]}</Badge>
                </TabsTrigger>
                <TabsTrigger value="30" className="gap-2">
                  30+ days
                  <Badge variant="secondary" className="h-5 px-1.5 text-xs">{counts["30"]}</Badge>
                </TabsTrigger>
                <TabsTrigger value="45" className="gap-2">
                  45+ days
                  <Badge variant="secondary" className="h-5 px-1.5 text-xs">{counts["45"]}</Badge>
                </TabsTrigger>
                <TabsTrigger value="unknown" className="gap-2">
                  Needs sync
                  <Badge variant="secondary" className="h-5 px-1.5 text-xs">{counts.unknown}</Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value={tab} className="mt-4">
                {isLoading ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">Loading...</div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    {tab === "unknown"
                      ? "✅ All your accounts have verified spend history."
                      : `🎉 No accounts inactive for ${tab}+ days. Great job staying active!`}
                  </div>
                ) : (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          <TableHead>BM</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Last Spend</TableHead>
                          <TableHead className="text-right">Inactive</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((a: any) => {
                          const bal = a.balance != null ? Number(a.balance) : Math.max(0, Number(a.spend_cap) - Number(a.amount_spent));
                          return (
                            <TableRow key={a.id} className="cursor-pointer" onClick={() => navigate(`/ad-accounts/${a.id}`)}>
                              <TableCell>
                                <p className="font-medium text-sm">{a.account_name}</p>
                                <p className="text-xs text-muted-foreground">{a.account_id}</p>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {a.business_managers?.name || "—"}
                              </TableCell>
                              <TableCell><StatusBadge status={a.status} /></TableCell>
                              <TableCell className="text-xs">
                                {a.last_spend_date ? a.last_spend_date.slice(0, 10) : <span className="text-muted-foreground">Unknown</span>}
                              </TableCell>
                              <TableCell className="text-right">
                                <InactiveBadge lastSpendDate={a.last_spend_date} showActive showUnknown />
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">${bal.toFixed(2)}</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2"
                                  onClick={(e) => { e.stopPropagation(); navigate(`/ad-accounts/${a.id}`); }}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
