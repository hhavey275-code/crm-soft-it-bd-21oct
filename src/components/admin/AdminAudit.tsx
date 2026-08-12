import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MoneyHealthPanel } from "@/components/admin/MoneyHealthPanel";
import { AlertCircle, CheckCircle2, Download, RefreshCw, ShieldAlert, Wrench } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { runSellerAudit, backfillOrphan, type AuditReport, type OrphanTopup } from "@/lib/sellerAudit";
import { ForwardAudit } from "./ForwardAudit";
import { exportAllSellersMonthly, getAvailableMonths, monthLabel, type Bucket } from "@/lib/sellerMonthlyExportAll";
import { formatBdt, formatDueAdvance } from "@/lib/sellerRunningTotal";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";

export function AdminAudit() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [refetching, setRefetching] = useState(false);
  const [exportBucket, setExportBucket] = useState<Bucket | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data: report, isLoading, refetch } = useQuery<AuditReport>({
    queryKey: ["seller-audit-report"],
    queryFn: () => runSellerAudit(),
    staleTime: 30_000,
  });

  const { data: months } = useQuery<Bucket[]>({
    queryKey: ["audit-available-months"],
    queryFn: getAvailableMonths,
    staleTime: 60_000,
  });

  // Default to latest month once loaded
  useEffect(() => {
    if (months && months.length && !exportBucket) {
      setExportBucket(months[0]);
    }
  }, [months, exportBucket]);

  const handleExport = async () => {
    if (!exportBucket) return;
    setExporting(true);
    try {
      const res = await exportAllSellersMonthly(exportBucket);
      toast.success(`Exported ${res.sheets} seller sheet(s) for ${monthLabel(exportBucket)}`);
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const fixOrphan = useMutation({
    mutationFn: async (orphan: OrphanTopup) => {
      await backfillOrphan(orphan, user?.id || null);
    },
    onSuccess: () => {
      toast.success("Orphan top-up backfilled into seller ledger");
      queryClient.invalidateQueries({ queryKey: ["seller-audit-report"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to backfill"),
  });

  const handleRefresh = async () => {
    setRefetching(true);
    try { await refetch(); toast.success("Audit refreshed"); }
    finally { setRefetching(false); }
  };

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Running audit…</div>;
  }
  if (!report) return null;

  const noIssues = report.summary.total_orphans === 0 && report.summary.total_skipped === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-primary" />
            Accounts Audit
          </h1>
          <p className="text-sm text-muted-foreground">
            Last run: {format(new Date(report.generated_at), "PPp")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={exportBucket ? `${exportBucket.year}-${exportBucket.month}` : ""}
            onValueChange={(v) => {
              const [y, m] = v.split("-").map(Number);
              setExportBucket({ year: y, month: m });
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Pick month" />
            </SelectTrigger>
            <SelectContent>
              {(months || []).map((b) => (
                <SelectItem key={`${b.year}-${b.month}`} value={`${b.year}-${b.month}`}>
                  {monthLabel(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleExport} disabled={exporting || !exportBucket}>
            <Download className={`h-4 w-4 mr-2 ${exporting ? "animate-pulse" : ""}`} />
            {exporting ? "Exporting…" : "Download Monthly Excel"}
          </Button>
          <Button onClick={handleRefresh} disabled={refetching} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${refetching ? "animate-spin" : ""}`} />
            Re-run audit
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className={report.summary.total_orphans > 0 ? "border-destructive" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Orphan top-ups
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{report.summary.total_orphans}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Approved client top-ups not in seller ledger
            </p>
          </CardContent>
        </Card>
        <Card className={report.summary.total_skipped > 0 ? "border-yellow-500" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Skipped seller rows
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{report.summary.total_skipped}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Visible in UI but not affecting balance
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sellers with issues
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{report.summary.sellers_with_issues}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Need attention
            </p>
          </CardContent>
        </Card>
      </div>

      {noIssues && (
        <Card className="border-green-500/40 bg-green-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <div>
              <p className="font-medium">All clear</p>
              <p className="text-sm text-muted-foreground">
                Every approved client top-up is reflected in the seller ledger and every seller transaction is being counted.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="money-health">
        <TabsList>
          <TabsTrigger value="money-health">Money Health</TabsTrigger>
          <TabsTrigger value="forwards">Telegram Forwards</TabsTrigger>
          <TabsTrigger value="orphans">
            Orphan Top-ups ({report.orphans.length})
          </TabsTrigger>
          <TabsTrigger value="skipped">
            Skipped Rows ({report.skipped.length})
          </TabsTrigger>
          <TabsTrigger value="balances">
            Per-seller Balance ({report.balances.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="money-health">
          <MoneyHealthPanel />
        </TabsContent>

        <TabsContent value="forwards">
          <ForwardAudit />
        </TabsContent>


        {/* Orphans */}
        <TabsContent value="orphans">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Approved at</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead>Seller</TableHead>
                    <TableHead className="text-right">USD</TableHead>
                    <TableHead className="text-right">BDT</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.orphans.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No orphan top-ups — every approved top-up is in the seller ledger ✅
                      </TableCell>
                    </TableRow>
                  ) : report.orphans.map((o) => (
                    <TableRow key={o.topup_id} className="bg-destructive/5">
                      <TableCell className="text-xs">
                        {o.approved_at ? format(new Date(o.approved_at), "MMM dd, HH:mm") : "—"}
                      </TableCell>
                      <TableCell>{o.user_name || o.user_id.slice(0, 8)}</TableCell>
                      <TableCell className="text-sm">{o.bank_name || "—"}</TableCell>
                      <TableCell>{o.seller_name || o.seller_id.slice(0, 8)}</TableCell>
                      <TableCell className="text-right">${o.amount_usd}</TableCell>
                      <TableCell className="text-right font-medium">{formatBdt(o.bdt_amount)}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="default"
                          disabled={fixOrphan.isPending}
                          onClick={() => fixOrphan.mutate(o)}
                        >
                          <Wrench className="h-3 w-3 mr-1" /> Fix
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Skipped rows */}
        <TabsContent value="skipped">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Seller</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">BDT</TableHead>
                    <TableHead className="text-right">USDT</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.skipped.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        No skipped rows ✅
                      </TableCell>
                    </TableRow>
                  ) : report.skipped.map((s) => (
                    <TableRow key={s.id} className="bg-yellow-500/5">
                      <TableCell className="text-xs">{format(new Date(s.created_at), "MMM dd, HH:mm")}</TableCell>
                      <TableCell>{s.seller_name || s.seller_id.slice(0, 8)}</TableCell>
                      <TableCell className="capitalize">{s.type.replace(/_/g, " ")}</TableCell>
                      <TableCell>
                        <Badge variant={s.status === "approved" ? "default" : "secondary"}>{s.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{s.bdt_amount ? formatBdt(s.bdt_amount) : "—"}</TableCell>
                      <TableCell className="text-right">{s.usdt_amount || "—"}</TableCell>
                      <TableCell className="text-right">{s.rate || "—"}</TableCell>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-1 text-yellow-700 dark:text-yellow-400">
                          <AlertCircle className="h-3 w-3" /> {s.reason}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Balances */}
        <TabsContent value="balances">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seller</TableHead>
                    <TableHead className="text-right">Computed Balance</TableHead>
                    <TableHead className="text-right">Total Txns</TableHead>
                    <TableHead className="text-right">Client Top-ups in ledger</TableHead>
                    <TableHead className="text-right">Orphans</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.balances.map((b) => {
                    const fmt = formatDueAdvance(b.computed_balance_bdt);
                    return (
                      <TableRow key={b.seller_id} className={b.orphan_topup_count > 0 ? "bg-destructive/5" : ""}>
                        <TableCell className="font-medium">{b.seller_name || b.seller_id.slice(0, 8)}</TableCell>
                        <TableCell className={`text-right font-semibold ${fmt.isAdvance ? "text-green-600" : fmt.isZero ? "" : "text-destructive"}`}>
                          {fmt.text}
                        </TableCell>
                        <TableCell className="text-right">{b.txn_count}</TableCell>
                        <TableCell className="text-right">{b.client_topup_in_ledger_count}</TableCell>
                        <TableCell className="text-right">
                          {b.orphan_topup_count > 0 ? (
                            <Badge variant="destructive">{b.orphan_topup_count}</Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}