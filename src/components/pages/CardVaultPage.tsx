import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CardBrandIcon } from "@/components/CardBrandIcon";
import { EditCardLabelDialog } from "@/components/admin/EditCardLabelDialog";
import { CreditCard, Search, Pencil, Download, Loader2 } from "lucide-react";
import { format } from "date-fns";

export default function CardVaultPage() {
  const [search, setSearch] = useState("");
  const [bmFilter, setBmFilter] = useState<string>("all");
  const [editing, setEditing] = useState<any>(null);

  const { data: bms } = useQuery({
    queryKey: ["card-vault-bms"],
    queryFn: async () => {
      const { data } = await supabase.from("business_managers").select("id, name").order("name");
      return data ?? [];
    },
  });

  const { data: cards, isLoading } = useQuery({
    queryKey: ["card-vault", bmFilter],
    queryFn: async () => {
      let q = (supabase as any).from("ad_account_cards").select("*, business_managers(name)").order("last_seen_at", { ascending: false });
      if (bmFilter !== "all") q = q.eq("bm_id", bmFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: assignmentCounts } = useQuery({
    queryKey: ["card-vault-assignment-counts"],
    queryFn: async () => {
      // Latest event per (ad_account, card) — count cards that are still attached
      const { data } = await (supabase as any)
        .from("ad_account_card_assignments")
        .select("card_id, ad_account_id, event_type, detected_at")
        .order("detected_at", { ascending: false })
        .limit(5000);
      const map: Record<string, { active: Set<string>; total: number }> = {};
      const seen = new Set<string>();
      for (const row of (data ?? []) as any[]) {
        if (!row.card_id) continue;
        const key = `${row.card_id}:${row.ad_account_id}`;
        if (!map[row.card_id]) map[row.card_id] = { active: new Set(), total: 0 };
        if (!seen.has(key)) {
          seen.add(key);
          map[row.card_id].total += 1;
          if (row.event_type !== "detached") map[row.card_id].active.add(row.ad_account_id);
        }
      }
      const out: Record<string, { active: number; total: number }> = {};
      for (const [cid, v] of Object.entries(map)) out[cid] = { active: v.active.size, total: v.total };
      return out;
    },
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return cards ?? [];
    return (cards ?? []).filter((c: any) =>
      (c.display_string ?? "").toLowerCase().includes(term) ||
      (c.admin_label ?? "").toLowerCase().includes(term) ||
      (c.bank_name ?? "").toLowerCase().includes(term) ||
      (c.holder_name ?? "").toLowerCase().includes(term) ||
      (c.funding_source_id ?? "").toLowerCase().includes(term)
    );
  }, [cards, search]);

  const exportCsv = () => {
    const rows = [
      ["Card", "Admin Label", "Bank", "Holder", "BM", "Type", "Expiry", "Active Accounts", "Total Seen", "First Seen", "Last Seen", "Funding Source ID"],
      ...filtered.map((c: any) => [
        c.display_string ?? "",
        c.admin_label ?? "",
        c.bank_name ?? "",
        c.holder_name ?? "",
        c.business_managers?.name ?? "",
        c.card_type ?? "",
        c.exp_month && c.exp_year ? `${c.exp_month}/${c.exp_year}` : "",
        String(assignmentCounts?.[c.id]?.active ?? 0),
        String(assignmentCounts?.[c.id]?.total ?? 0),
        c.first_seen_at ? format(new Date(c.first_seen_at), "yyyy-MM-dd") : "",
        c.last_seen_at ? format(new Date(c.last_seen_at), "yyyy-MM-dd") : "",
        c.funding_source_id ?? "",
      ]),
    ];
    const csv = rows.map((r: any[]) => r.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `card-vault-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CreditCard className="h-6 w-6" /> Card Vault
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Master registry of every card detected across your Business Managers — used for hack recovery and audit.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by last 4, label, bank, holder…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
              </div>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={bmFilter}
                onChange={(e) => setBmFilter(e.target.value)}
              >
                <option value="all">All Business Managers</option>
                {(bms ?? []).map((b: any) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No cards found yet. Cards will appear here automatically as ad accounts are synced.
              </p>
            ) : (
              <div className="rounded-md border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Card</TableHead>
                      <TableHead>Label / Bank</TableHead>
                      <TableHead>BM</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead className="text-right">Accounts</TableHead>
                      <TableHead>Last Seen</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((c: any) => {
                      const counts = assignmentCounts?.[c.id];
                      return (
                        <TableRow key={c.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <CardBrandIcon displayString={c.display_string} />
                              <span className="text-sm font-medium">{c.display_string}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{c.admin_label || <span className="text-muted-foreground italic">—</span>}</div>
                            <div className="text-xs text-muted-foreground">{c.bank_name || ""}{c.bank_name && c.holder_name ? " · " : ""}{c.holder_name || ""}</div>
                          </TableCell>
                          <TableCell className="text-sm">{c.business_managers?.name ?? "—"}</TableCell>
                          <TableCell className="text-sm">
                            {c.exp_month && c.exp_year ? `${String(c.exp_month).padStart(2, "0")}/${c.exp_year}` : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            <Badge variant={counts?.active ? "default" : "secondary"} className="text-xs">
                              {counts?.active ?? 0} active
                            </Badge>
                            {counts && counts.total > counts.active && (
                              <span className="text-xs text-muted-foreground ml-1">/ {counts.total} total</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {c.last_seen_at ? format(new Date(c.last_seen_at), "MMM d, yyyy") : "—"}
                          </TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(c)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <EditCardLabelDialog card={editing} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} />
      </div>
    </DashboardLayout>
  );
}
