import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/admin/ConfirmActionDialog";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Download, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import {
  fetchSellerArchiveBundle,
  splitBuckets,
  sumIn,
  sumUsdt,
  sumWithdraw,
  computeDueAdvancePair,
  type ArchiveTxn,
} from "@/lib/oldSellerData";
import { formatBdt, formatDueAdvance } from "@/lib/sellerRunningTotal";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtUsd(v: number | null | undefined) {
  if (v == null) return "—";
  return `$${Number(v).toFixed(2)}`;
}

function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (v: any) => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes("\n") || s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(","), ...rows.map((r) => r.map(escape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Extract a likely TRX ID from a description string.
 * Looks for explicit "trx[id]: XXXX" / "txn id XXXX" patterns first, then
 * falls back to any alphanumeric token of length >= 6 (typical bank trxIDs).
 * Returns null if nothing usable is found.
 */
export function extractTrxId(desc: string | null | undefined): string | null {
  if (!desc) return null;
  const s = String(desc);
  const labeled = s.match(/(?:trx\s*id|txn\s*id|trxn|trx|txn|reference|ref)\s*[:#\-]?\s*([A-Za-z0-9]{4,})/i);
  if (labeled?.[1]) return labeled[1].toUpperCase();
  const tokens = s.match(/[A-Za-z0-9]{6,}/g);
  if (tokens && tokens.length) {
    // Prefer tokens that contain at least one digit (transaction IDs usually do)
    const withDigit = tokens.find((t) => /\d/.test(t));
    return (withDigit || tokens[0]).toUpperCase();
  }
  return null;
}

/** Build a Set of archive row IDs that are duplicates (same trxId + bdt + type). */
export function buildDuplicateIdSet(rows: ArchiveTxn[]): Set<string> {
  const groups = new Map<string, ArchiveTxn[]>();
  for (const r of rows) {
    const trx = extractTrxId(r.description);
    if (!trx) continue;
    const key = `${trx}|${Math.round(r.bdt_amount)}|${r.type}`;
    const arr = groups.get(key) || [];
    arr.push(r);
    groups.set(key, arr);
  }
  const dupes = new Set<string>();
  for (const arr of groups.values()) {
    if (arr.length > 1) for (const r of arr) dupes.add(r.id);
  }
  return dupes;
}

export function OldSellerBreakdown({ sellerId, sellerName }: { sellerId: string; sellerName: string }) {
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ArchiveTxn | null>(null);
  const queryClient = useQueryClient();

  const handleDelete = async (row: ArchiveTxn) => {
    const { error: delErr } = await (supabase as any)
      .from("seller_transactions_archive_2026_05")
      .delete()
      .eq("id", row.id);
    if (delErr) {
      toast.error(`Delete failed: ${delErr.message}`);
      return;
    }
    toast.success("Duplicate entry deleted");
    queryClient.invalidateQueries({ queryKey: ["old-seller-bundle", sellerId] });
    queryClient.invalidateQueries({ queryKey: ["archived-sellers"] });
  };


  const { data, isLoading, error } = useQuery({
    queryKey: ["old-seller-bundle", sellerId],
    queryFn: () => fetchSellerArchiveBundle(sellerId),
    enabled: !!sellerId,
  });

  const buckets = useMemo(() => (data ? splitBuckets(data.txns) : null), [data]);
  const totals = useMemo(() => {
    if (!buckets) return null;
    return {
      forwardedIn: sumIn(buckets.forwardedIn),
      notForwardedIn: sumIn(buckets.notForwardedIn),
      usdt: sumUsdt(buckets.usdtGiven),
      withdraw: sumWithdraw(buckets.withdraws),
      due: computeDueAdvancePair(buckets),
    };
  }, [buckets]);

  // Orphan check: top_up_requests during archive period that don't appear in archive ledger
  const orphans = useMemo(() => {
    if (!data) return [];
    const ledgerIds = new Set(
      data.txns
        .filter((t) => t.type === "client_topup" && t.top_up_request_id)
        .map((t) => t.top_up_request_id!),
    );
    return (data.topupRequests || []).filter(
      (r: any) => r.status === "approved" && !ledgerIds.has(r.id),
    );
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading archive…
      </div>
    );
  }
  if (error) {
    return <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm">Failed to load: {(error as any).message}</div>;
  }
  if (!data || !buckets || !totals) return null;

  const filterRows = (rows: ArchiveTxn[]) => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        (r.description || "").toLowerCase().includes(q) ||
        (r.bank_name || "").toLowerCase().includes(q) ||
        (r.entry_by_name || "").toLowerCase().includes(q) ||
        (r.account_number || "").toLowerCase().includes(q),
    );
  };

  const due = totals.due;
  const fwdDisplay = formatDueAdvance(due.forwardedOnly);
  const allDisplay = formatDueAdvance(due.all);
  const drift = due.all - due.forwardedOnly; // should equal not-forwarded TOP-UPS only (manuals are mirrored, not added)
  const expectedDrift = buckets.notForwardedIn
    .filter((t) => t.type === "client_topup")
    .reduce((s, t) => s + t.bdt_amount, 0);
  const driftMatches = Math.abs(drift - expectedDrift) < 0.5;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          title="🟢 Forwarded Payments IN"
          subtitle="Top-ups that hit Telegram"
          primary={formatBdt(totals.forwardedIn.bdt)}
          secondary={`${totals.forwardedIn.count} entries`}
          tone="success"
        />
        <SummaryCard
          title="🔴 Not-Forwarded Payments IN"
          subtitle="Top-ups not forwarded + all manual entries (mirrored)"
          primary={formatBdt(totals.notForwardedIn.bdt)}
          secondary={`${totals.notForwardedIn.count} entries`}
          tone="danger"
        />
        <SummaryCard
          title="💵 USDT Given to Client"
          subtitle="Always counts in both totals"
          primary={`${totals.usdt.usdt.toLocaleString()} USDT`}
          secondary={`${formatBdt(totals.usdt.bdtFromUsdt)} cost · ${totals.usdt.count} entries`}
          tone="warn"
        />
        <SummaryCard
          title="💸 Withdraw"
          subtitle="Always counts in both totals"
          primary={formatBdt(totals.withdraw.bdt)}
          secondary={`${totals.withdraw.count} entries`}
          tone="warn"
        />
        <SummaryCard
          title="⚖️ Due/Advance — Forwarded only"
          subtitle="Forwarded IN − USDT cost − Withdraw"
          primary={fwdDisplay.text}
          secondary={fwdDisplay.isAdvance ? "Advance" : fwdDisplay.isZero ? "Settled" : "Due"}
          tone={fwdDisplay.isAdvance ? "success" : fwdDisplay.isZero ? "muted" : "danger"}
        />
        <SummaryCard
          title="⚖️ Due/Advance — All combined"
          subtitle="(Forwarded + Not-fwd) IN − USDT cost − Withdraw"
          primary={allDisplay.text}
          secondary={allDisplay.isAdvance ? "Advance" : allDisplay.isZero ? "Settled" : "Due"}
          tone={allDisplay.isAdvance ? "success" : allDisplay.isZero ? "muted" : "danger"}
        />
      </div>

      {/* Reconciliation note */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reconciliation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            Difference between <b>All</b> and <b>Forwarded-only</b> Due/Advance: <b>{formatBdt(drift)}</b>
          </div>
          <div>
            Expected difference (= Not-forwarded payments IN): <b>{formatBdt(expectedDrift)}</b>
          </div>
          {driftMatches ? (
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Numbers reconcile cleanly.
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" /> Drift detected — investigate manually.
            </div>
          )}
          {orphans.length > 0 && (
            <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-medium">
                <AlertTriangle className="h-4 w-4" /> {orphans.length} approved top-up request(s) missing from ledger
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                These top-ups were approved during the archive period but never produced a seller_transactions row.
                Their BDT is NOT counted in any total above. Review and decide if they need manual entry.
              </p>
              <div className="mt-2 overflow-x-auto rounded border bg-background">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">USD</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">BDT</TableHead>
                      <TableHead>Forwarded</TableHead>
                      <TableHead className="text-xs">Top-up ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orphans.map((o: any) => (
                      <TableRow key={o.id}>
                        <TableCell className="whitespace-nowrap text-xs">{fmtDate(o.created_at)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">${Number(o.amount).toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">৳{o.usd_rate}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBdt(Number(o.bdt_amount || 0))}</TableCell>
                        <TableCell>
                          {o.telegram_forwarded ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-rose-500" />
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">{o.id.slice(0, 8)}…</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3}>Total ({orphans.length})</TableCell>
                      <TableCell className="text-right tabular-nums font-bold">
                        {formatBdt(orphans.reduce((s: number, o: any) => s + Number(o.bdt_amount || 0), 0))}
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search description, bank, entry by, account #…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <span className="text-xs text-muted-foreground">{sellerName} · archive period</span>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="forwarded">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="forwarded">Forwarded ({buckets.forwardedIn.length})</TabsTrigger>
          <TabsTrigger value="notForwarded">Not-Forwarded ({buckets.notForwardedIn.length})</TabsTrigger>
          <TabsTrigger value="usdt">USDT ({buckets.usdtGiven.length})</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw ({buckets.withdraws.length})</TabsTrigger>
          <TabsTrigger value="all">All ({data.txns.length})</TabsTrigger>
          <TabsTrigger value="topups">Top-up Requests ({data.topupRequests.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="forwarded">
          <PaymentsTable
            rows={filterRows(buckets.forwardedIn)}
            forwarded
            csvName={`${sellerName}-forwarded.csv`}
          />
        </TabsContent>
        <TabsContent value="notForwarded">
          <PaymentsTable
            rows={filterRows(buckets.notForwardedIn)}
            forwarded={false}
            csvName={`${sellerName}-not-forwarded.csv`}
          />
        </TabsContent>
        <TabsContent value="usdt">
          <UsdtTable rows={filterRows(buckets.usdtGiven)} csvName={`${sellerName}-usdt.csv`} />
        </TabsContent>
        <TabsContent value="withdraw">
          <WithdrawTable rows={filterRows(buckets.withdraws)} csvName={`${sellerName}-withdraw.csv`} />
        </TabsContent>
        <TabsContent value="all">
          <AllTable rows={filterRows(data.txns)} csvName={`${sellerName}-all.csv`} />
        </TabsContent>
        <TabsContent value="topups">
          <TopupsTable
            rows={data.topupRequests}
            ledgerIds={new Set(
              data.txns.filter((t) => t.type === "client_topup" && t.top_up_request_id).map((t) => t.top_up_request_id!),
            )}
            csvName={`${sellerName}-topups.csv`}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({
  title,
  subtitle,
  primary,
  secondary,
  tone,
}: {
  title: string;
  subtitle: string;
  primary: string;
  secondary: string;
  tone: "success" | "danger" | "warn" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-500/40 bg-emerald-500/5"
      : tone === "danger"
      ? "border-rose-500/40 bg-rose-500/5"
      : tone === "warn"
      ? "border-amber-500/40 bg-amber-500/5"
      : "border-border";
  return (
    <Card className={toneClass}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{primary}</div>
        <p className="mt-1 text-xs text-muted-foreground">{secondary}</p>
      </CardContent>
    </Card>
  );
}

function typeBadge(type: string) {
  const map: Record<string, string> = {
    bdt_payment: "BDT Payment",
    client_topup: "Client Top-up",
    tenant_payment: "Tenant Pay",
    withdraw: "Withdraw",
    usdt_received: "USDT Given",
  };
  return <Badge variant="outline" className="text-[10px]">{map[type] || type}</Badge>;
}

function PaymentsTable({ rows, forwarded, csvName }: { rows: ArchiveTxn[]; forwarded: boolean; csvName: string }) {
  // Sort chronologically and compute running total (seller-sheet style).
  const sorted = useMemo(
    () => [...rows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [rows],
  );
  let running = 0;
  const withRunning = sorted.map((r) => {
    const prev = running;
    running += r.bdt_amount;
    const delta = r.bdt_amount;
    return { row: r, prev, after: running, delta };
  });
  const total = running;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          {forwarded ? "Forwarded Payments IN" : "Not-Forwarded Payments IN"}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            (Manual entries shown in both sheets · running total updates per row)
          </span>
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadCsv(
              csvName,
              ["Date", "Type", "BDT in", "Change", "Running total", "Description / TrxID", "Bank", "Account #", "Entry by"],
              withRunning.map(({ row: r, delta, after }) => [
                fmtDate(r.created_at),
                r.type,
                r.bdt_amount,
                delta,
                after,
                r.description,
                r.bank_name,
                r.account_number,
                r.entry_by_name,
              ]),
            )
          }
        >
          <Download className="mr-1 h-3 w-3" /> CSV
        </Button>
      </CardHeader>
      <CardContent>
        <div className="rounded border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date / Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">BDT in</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Running total</TableHead>
                <TableHead>Description / TrxID</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead>Entry by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {withRunning.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">No entries</TableCell>
                </TableRow>
              ) : (
                withRunning.map(({ row: r, delta, after }) => {
                  const isManual = r.type === "bdt_payment" || r.type === "tenant_payment";
                  return (
                    <TableRow key={r.id} className={isManual ? "bg-amber-500/5" : undefined}>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.created_at)}</TableCell>
                      <TableCell>
                        {typeBadge(r.type)}
                        {isManual && <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">manual</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatBdt(r.bdt_amount)}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        +{formatBdt(delta)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{formatBdt(after)}</TableCell>
                      <TableCell className="max-w-xs truncate text-xs" title={r.description || ""}>{r.description || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {r.bank_name ? `${r.bank_name}${r.account_number ? ` · ${r.account_number}` : ""}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{r.entry_by_name || "—"}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>Total ({withRunning.length})</TableCell>
                <TableCell className="text-right tabular-nums font-bold">{formatBdt(total)}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums font-bold">{formatBdt(total)}</TableCell>
                <TableCell colSpan={3} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function UsdtTable({ rows, csvName }: { rows: ArchiveTxn[]; csvName: string }) {
  const totalUsdt = rows.reduce((s, r) => s + r.usdt_amount, 0);
  const totalBdt = rows.reduce((s, r) => s + r.usdt_amount * r.rate, 0);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">USDT Given to Client</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadCsv(
              csvName,
              ["Date", "USDT", "Rate", "BDT cost", "Bank", "Description", "Entry by"],
              rows.map((r) => [fmtDate(r.created_at), r.usdt_amount, r.rate, r.usdt_amount * r.rate, r.bank_name, r.description, r.entry_by_name]),
            )
          }
        >
          <Download className="mr-1 h-3 w-3" /> CSV
        </Button>
      </CardHeader>
      <CardContent>
        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date / Time</TableHead>
                <TableHead className="text-right">USDT</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">BDT cost</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Entry by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No entries</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.created_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.usdt_amount.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">৳{r.rate}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBdt(r.usdt_amount * r.rate)}</TableCell>
                    <TableCell className="text-xs">{r.bank_name || "—"}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs" title={r.description || ""}>{r.description || "—"}</TableCell>
                    <TableCell className="text-xs">{r.entry_by_name || "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total ({rows.length})</TableCell>
                <TableCell className="text-right tabular-nums font-bold">{totalUsdt.toLocaleString()}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums font-bold">{formatBdt(totalBdt)}</TableCell>
                <TableCell colSpan={3} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function WithdrawTable({ rows, csvName }: { rows: ArchiveTxn[]; csvName: string }) {
  const total = rows.reduce((s, r) => s + r.bdt_amount, 0);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Withdraws</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadCsv(
              csvName,
              ["Date", "BDT", "Description", "Entry by"],
              rows.map((r) => [fmtDate(r.created_at), r.bdt_amount, r.description, r.entry_by_name]),
            )
          }
        >
          <Download className="mr-1 h-3 w-3" /> CSV
        </Button>
      </CardHeader>
      <CardContent>
        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date / Time</TableHead>
                <TableHead className="text-right">BDT</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Entry by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No entries</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.created_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBdt(r.bdt_amount)}</TableCell>
                    <TableCell className="text-xs">{r.description || "—"}</TableCell>
                    <TableCell className="text-xs">{r.entry_by_name || "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total ({rows.length})</TableCell>
                <TableCell className="text-right tabular-nums font-bold">{formatBdt(total)}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function AllTable({ rows, csvName }: { rows: ArchiveTxn[]; csvName: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">All Archive Transactions</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadCsv(
              csvName,
              ["Date", "Type", "Status", "BDT", "USDT", "Rate", "Description", "Bank", "Account #", "Entry by", "Forwarded?"],
              rows.map((r) => [
                fmtDate(r.created_at),
                r.type,
                r.status,
                r.bdt_amount,
                r.usdt_amount,
                r.rate,
                r.description,
                r.bank_name,
                r.account_number,
                r.entry_by_name,
                r.topup_forwarded == null ? "" : r.topup_forwarded ? "yes" : "no",
              ]),
            )
          }
        >
          <Download className="mr-1 h-3 w-3" /> CSV
        </Button>
      </CardHeader>
      <CardContent>
        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date / Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">BDT</TableHead>
                <TableHead className="text-right">USDT</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead>Entry by</TableHead>
                <TableHead>Fwd?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.created_at)}</TableCell>
                  <TableCell>{typeBadge(r.type)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.bdt_amount ? formatBdt(r.bdt_amount) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.usdt_amount ? r.usdt_amount.toLocaleString() : "—"}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs" title={r.description || ""}>{r.description || "—"}</TableCell>
                  <TableCell className="text-xs">{r.bank_name || "—"}</TableCell>
                  <TableCell className="text-xs">{r.entry_by_name || "—"}</TableCell>
                  <TableCell>
                    {r.topup_forwarded === true ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : r.topup_forwarded === false ? (
                      <XCircle className="h-4 w-4 text-rose-500" />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function TopupsTable({ rows, ledgerIds, csvName }: { rows: any[]; ledgerIds: Set<string>; csvName: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Top-up Requests during archive period</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadCsv(
              csvName,
              ["Date", "USD", "Rate", "BDT", "Status", "Forwarded", "In ledger"],
              rows.map((r) => [
                fmtDate(r.created_at),
                r.amount,
                r.usd_rate,
                r.bdt_amount,
                r.status,
                r.telegram_forwarded ? "yes" : "no",
                ledgerIds.has(r.id) ? "yes" : "no",
              ]),
            )
          }
        >
          <Download className="mr-1 h-3 w-3" /> CSV
        </Button>
      </CardHeader>
      <CardContent>
        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date / Time</TableHead>
                <TableHead className="text-right">USD</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">BDT</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Forwarded</TableHead>
                <TableHead>In ledger</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No top-up requests</TableCell></TableRow>
              ) : (
                rows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.created_at)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">${Number(r.amount).toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">৳{r.usd_rate}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBdt(Number(r.bdt_amount || 0))}</TableCell>
                    <TableCell><Badge variant={r.status === "approved" ? "default" : "secondary"} className="text-[10px]">{r.status}</Badge></TableCell>
                    <TableCell>
                      {r.telegram_forwarded ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-rose-500" />
                      )}
                    </TableCell>
                    <TableCell>
                      {ledgerIds.has(r.id) ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : r.status === "approved" ? (
                        <span title="Orphan — approved top-up not in ledger"><AlertTriangle className="h-4 w-4 text-amber-500" /></span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
