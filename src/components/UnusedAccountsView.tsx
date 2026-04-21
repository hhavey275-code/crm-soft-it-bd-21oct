import { useMemo, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { InactiveBadge } from "@/components/InactiveBadge";
import { getInactiveDays } from "@/lib/inactiveDays";
import { Search, ExternalLink } from "lucide-react";

type Tier = "15" | "30" | "45" | "unknown";

export interface UnusedAccount {
  id: string;
  account_id: string;
  account_name: string;
  status: string;
  spend_cap?: number | null;
  amount_spent?: number | null;
  created_at: string;
  business_managers?: { name?: string | null } | null;
  // From insights / overrides
  last_spend_date?: string | null;
  balance?: number | null;
}

interface Props {
  accounts: UnusedAccount[];
  isLoading?: boolean;
  showSearch?: boolean;
  emptyMessage?: string;
}

export function UnusedAccountsView({ accounts, isLoading, showSearch = true, emptyMessage }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tier>("15");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts
      .map((a) => ({ ...a, _info: getInactiveDays(a.last_spend_date ?? null) }))
      .filter((a) => {
        if (tab === "unknown") return a._info.isUnknown;
        if (a._info.isUnknown) return false;
        const minDays = parseInt(tab);
        return a._info.days >= minDays;
      })
      .filter((a) => {
        if (!q) return true;
        return (
          a.account_name?.toLowerCase().includes(q) ||
          a.account_id?.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b._info.days - a._info.days);
  }, [accounts, tab, search]);

  const counts = useMemo(() => {
    const c = { "15": 0, "30": 0, "45": 0, unknown: 0 };
    accounts.forEach((a) => {
      const info = getInactiveDays(a.last_spend_date ?? null);
      if (info.isUnknown) {
        c.unknown++;
        return;
      }
      const d = info.days;
      if (d >= 15) c["15"]++;
      if (d >= 30) c["30"]++;
      if (d >= 45) c["45"]++;
    });
    return c;
  }, [accounts]);

  return (
    <div className="space-y-3">
      {showSearch && (
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search account name / ID..."
            className="pl-8 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

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
              {emptyMessage ?? (
                tab === "unknown"
                  ? `✅ All accounts have verified spend history.`
                  : `🎉 No accounts inactive for ${tab}+ days.`
              )}
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
                  {filtered.map((a) => {
                    const bal = a.balance != null
                      ? Number(a.balance)
                      : Math.max(0, Number(a.spend_cap ?? 0) - Number(a.amount_spent ?? 0));
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
                          <InactiveBadge lastSpendDate={a.last_spend_date ?? null} showActive showUnknown />
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
    </div>
  );
}
