import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusBadge } from "@/components/StatusBadge";
import { InactiveBadge } from "@/components/InactiveBadge";
import { getInactiveDays } from "@/lib/inactiveDays";
import { Search, ChevronRight, ExternalLink, User, Package } from "lucide-react";
import { cn } from "@/lib/utils";

type Tier = "15" | "30" | "45" | "unknown";

export interface AdminUnusedAccount {
  id: string;
  account_id: string;
  account_name: string;
  status: string;
  spend_cap?: number | null;
  amount_spent?: number | null;
  created_at: string;
  business_managers?: { name?: string | null } | null;
  last_spend_date?: string | null;
  balance?: number | null;
  // Owner info
  user_id?: string | null;
  client_name?: string | null;
  client_email?: string | null;
}

interface Props {
  accounts: AdminUnusedAccount[];
  isLoading?: boolean;
}

const UNASSIGNED_KEY = "__unassigned__";

export function AdminUnusedAccountsView({ accounts, isLoading }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tier>("15");
  const [search, setSearch] = useState("");
  const [openClients, setOpenClients] = useState<Set<string>>(new Set());

  const enrichedAll = useMemo(() => {
    return accounts.map((a) => ({
      ...a,
      _info: getInactiveDays(a.last_spend_date ?? null),
    }));
  }, [accounts]);

  const counts = useMemo(() => {
    const c = { "15": 0, "30": 0, "45": 0, unknown: 0 };
    enrichedAll.forEach((a) => {
      if (a._info.isUnknown) {
        c.unknown++;
        return;
      }
      const d = a._info.days;
      if (d >= 15) c["15"]++;
      if (d >= 30) c["30"]++;
      if (d >= 45) c["45"]++;
    });
    return c;
  }, [enrichedAll]);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = enrichedAll
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
          a.account_id?.toLowerCase().includes(q) ||
          a.client_name?.toLowerCase().includes(q) ||
          a.client_email?.toLowerCase().includes(q)
        );
      });

    const map = new Map<string, { key: string; name: string; email: string | null; user_id: string | null; accounts: typeof filtered }>();
    for (const a of filtered) {
      const key = a.user_id || UNASSIGNED_KEY;
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: a.user_id ? (a.client_name || a.client_email || "Unknown Client") : "Unassigned (Inventory)",
          email: a.client_email ?? null,
          user_id: a.user_id ?? null,
          accounts: [],
        });
      }
      map.get(key)!.accounts.push(a);
    }
    // Sort each group's accounts by inactive days desc
    map.forEach((g) => g.accounts.sort((a, b) => b._info.days - a._info.days));
    // Sort groups by total unused account count desc; unassigned last
    return Array.from(map.values()).sort((a, b) => {
      if (a.key === UNASSIGNED_KEY) return 1;
      if (b.key === UNASSIGNED_KEY) return -1;
      return b.accounts.length - a.accounts.length;
    });
  }, [enrichedAll, tab, search]);

  const toggleClient = (key: string) => {
    setOpenClients((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const expandAll = () => setOpenClients(new Set(grouped.map((g) => g.key)));
  const collapseAll = () => setOpenClients(new Set());

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search account / client..."
            className="pl-8 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={expandAll}>Expand all</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={collapseAll}>Collapse all</Button>
        </div>
      </div>

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

        <TabsContent value={tab} className="mt-4 space-y-2">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Loading...</div>
          ) : grouped.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {tab === "unknown"
                ? "✅ All accounts have verified spend history."
                : `🎉 No accounts inactive for ${tab}+ days.`}
            </div>
          ) : (
            grouped.map((g) => {
              const isOpen = openClients.has(g.key);
              const isUnassigned = g.key === UNASSIGNED_KEY;
              return (
                <Collapsible key={g.key} open={isOpen} onOpenChange={() => toggleClient(g.key)}>
                  <CollapsibleTrigger asChild>
                    <button className="w-full flex items-center justify-between gap-3 rounded-md border bg-muted/30 hover:bg-muted/60 transition-colors px-3 py-2 text-left">
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0", isOpen && "rotate-90")} />
                        {isUnassigned ? (
                          <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <User className="h-4 w-4 text-primary shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{g.name}</p>
                          {g.email && !isUnassigned && (
                            <p className="text-xs text-muted-foreground truncate">{g.email}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary" className="text-xs">
                          {g.accounts.length} account{g.accounts.length !== 1 ? "s" : ""}
                        </Badge>
                        {!isUnassigned && g.user_id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={(e) => { e.stopPropagation(); navigate(`/clients/${g.user_id}`); }}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="rounded-md border border-t-0 overflow-x-auto rounded-t-none">
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
                          {g.accounts.map((a) => {
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
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
