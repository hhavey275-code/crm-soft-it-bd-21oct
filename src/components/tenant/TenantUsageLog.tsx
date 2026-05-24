import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

type RowKind = {
  label: string;
  sign: 1 | -1 | 0;
  badgeClass: string;
  amountClass: string;
  Icon?: typeof TrendingDown;
};

function classifyRow(action: string | null | undefined, source: string | null | undefined): RowKind {
  const a = (action || "").toLowerCase();
  const s = (source || "").toLowerCase();

  if (a === "report-usage" || a === "usage_topup") {
    return {
      label: "Consumed",
      sign: -1,
      badgeClass: "bg-destructive/10 text-destructive border-destructive/20",
      amountClass: "text-destructive",
      Icon: TrendingDown,
    };
  }
  if (a === "refund-usage" || a === "usage_refund") {
    return {
      label: "Refunded",
      sign: 1,
      badgeClass: "bg-green-500/10 text-green-600 border-green-500/20",
      amountClass: "text-green-600",
      Icon: TrendingUp,
    };
  }
  if (s.includes("reconcile") || s.includes("master_sync") || s.includes("master:reconcile")) {
    return {
      label: "Master Sync",
      sign: 0,
      badgeClass: "bg-muted text-muted-foreground border-border",
      amountClass: "text-muted-foreground",
    };
  }
  // fallback
  return {
    label: action || source || "—",
    sign: 0,
    badgeClass: "bg-muted text-muted-foreground border-border",
    amountClass: "text-muted-foreground",
  };
}

function classifyLedgerRow(movementType: string | null | undefined): RowKind {
  const mt = (movementType || "").toLowerCase();

  if (mt === "usage_topup" || mt === "report-usage") {
    return {
      label: "Consumed",
      sign: -1,
      badgeClass: "bg-destructive/10 text-destructive border-destructive/20",
      amountClass: "text-destructive",
      Icon: TrendingDown,
    };
  }
  if (mt === "usage_refund" || mt === "refund-usage") {
    return {
      label: "Refunded Used",
      sign: 1,
      badgeClass: "bg-green-500/10 text-green-600 border-green-500/20",
      amountClass: "text-green-600",
      Icon: TrendingUp,
    };
  }
  if (mt === "limit_purchase" || mt === "limit_manual_increase") {
    return {
      label: mt === "limit_purchase" ? "Limit Top-Up" : "Manual Increase",
      sign: 1,
      badgeClass: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      amountClass: "text-blue-600",
      Icon: TrendingUp,
    };
  }
  if (mt === "limit_manual_decrease") {
    return {
      label: "Manual Decrease",
      sign: -1,
      badgeClass: "bg-destructive/10 text-destructive border-destructive/20",
      amountClass: "text-destructive",
      Icon: TrendingDown,
    };
  }
  if (mt === "limit_set") {
    return {
      label: "Limit Set",
      sign: 0,
      badgeClass: "bg-muted text-muted-foreground border-border",
      amountClass: "text-foreground",
    };
  }
  return {
    label: movementType || "—",
    sign: 0,
    badgeClass: "bg-muted text-muted-foreground border-border",
    amountClass: "text-muted-foreground",
  };
}

export function TenantUsageLog() {
  const { data: licenseData, refetch: refetchLicense } = useQuery({
    queryKey: ["license-data-usage-log"],
    queryFn: async () => {
      const keys = ["license_system_limit", "license_total_used", "master_url", "tenant_api_key"];
      const { data } = await supabase.from("site_settings").select("key, value").in("key", keys);
      const map: Record<string, string> = {};
      (data || []).forEach((r: any) => { map[r.key] = r.value; });
      return map;
    },
    refetchInterval: 30 * 1000,
  });

  const localTotalUsed = Number(licenseData?.license_total_used || 0);
  const systemLimit = Number(licenseData?.license_system_limit || 0);
  const remaining = systemLimit - localTotalUsed;
  const usagePercent = systemLimit > 0 ? (localTotalUsed / systemLimit) * 100 : 0;
  const masterUrl = licenseData?.master_url;
  const tenantApiKey = licenseData?.tenant_api_key;

  const { data: masterSnapshot, refetch: refetchMaster, isFetching: masterFetching } = useQuery({
    queryKey: ["master-usage-snapshot"],
    queryFn: async () => {
      if (!masterUrl || !tenantApiKey) return null;
      const res = await fetch(`${masterUrl}/functions/v1/tenant-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Key": tenantApiKey },
        body: JSON.stringify({ action: "heartbeat" }),
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!masterUrl && !!tenantApiKey,
    refetchInterval: 60 * 1000,
  });

  const masterTotalUsed = Number(masterSnapshot?.total_used ?? localTotalUsed);
  const drift = masterTotalUsed - localTotalUsed;
  const hasDrift = Math.abs(drift) > 0.01;

  const { data: auditRows, refetch: refetchAudit, isFetching: auditFetching } = useQuery({
    queryKey: ["tenant-usage-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_usage_audit")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30 * 1000,
  });

  const { data: masterLedger, refetch: refetchLedger, isFetching: ledgerFetching } = useQuery({
    queryKey: ["master-tenant-limit-ledger"],
    queryFn: async () => {
      if (!masterUrl || !tenantApiKey) return [];
      const res = await fetch(`${masterUrl}/functions/v1/tenant-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Key": tenantApiKey },
        body: JSON.stringify({ action: "get-ledger", limit: 300 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load ledger");
      return data.ledger || [];
    },
    enabled: !!masterUrl && !!tenantApiKey,
    refetchInterval: 30 * 1000,
  });

  const refreshAll = () => {
    refetchLicense();
    refetchMaster();
    refetchAudit();
    refetchLedger();
  };

  const fmt = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Usage Log
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Limit ki vabe komche ar Master er sathe sync ache kina dekho
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refreshAll} disabled={masterFetching || auditFetching || ledgerFetching}>
          <RefreshCw className={`h-4 w-4 ${(masterFetching || auditFetching || ledgerFetching) ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Local Total Used</CardDescription>
            <CardTitle className="text-xl sm:text-2xl">{fmt(localTotalUsed)}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">Tenant DB cached value</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Master Total Used</CardDescription>
            <CardTitle className="text-xl sm:text-2xl">{fmt(masterTotalUsed)}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">Live from master heartbeat</p>
          </CardContent>
        </Card>
        <Card className={hasDrift ? "border-destructive" : "border-green-500/30"}>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1">
              {hasDrift ? <AlertTriangle className="h-3 w-3 text-destructive" /> : <CheckCircle2 className="h-3 w-3 text-green-500" />}
              Drift (Master - Local)
            </CardDescription>
            <CardTitle className={`text-xl sm:text-2xl ${hasDrift ? "text-destructive" : "text-green-500"}`}>
              {drift > 0 ? "+" : ""}{fmt(drift)}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">
              {hasDrift ? "Mismatch detected — check audit below" : "In sync ✓"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Limit progress */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm sm:text-base">System Limit Usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 justify-between text-xs sm:text-sm">
            <span>Used: {fmt(localTotalUsed)}</span>
            <span>Limit: {fmt(systemLimit)}</span>
          </div>
          <Progress value={Math.min(usagePercent, 100)} className="h-3" />
          <div className="flex flex-wrap gap-2 justify-between">
            <Badge variant={remaining > 0 ? "default" : "destructive"}>
              Remaining: {fmt(remaining)}
            </Badge>
            <span className="text-xs text-muted-foreground">{usagePercent.toFixed(1)}% used</span>
          </div>
        </CardContent>
      </Card>

      {/* Audit table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm sm:text-base">Master Limit Ledger</CardTitle>
          <CardDescription className="text-xs">
            Master DB theke durable ledger: tenant top-up, spend-cap consumption, refund, manual increase/decrease reason সহ।
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 px-3 sm:px-6">
          {(masterLedger || []).map((row: any) => {
            const kind = classifyLedgerRow(row.movement_type);
            const delta = Number(row.amount_delta || 0);
            const amount = Math.abs(delta);
            const sign = kind.sign === -1 ? "−" : kind.sign === 1 || delta > 0 ? "+" : "";
            const meta = row.meta || {};
            const accountName = meta.account_name || meta.ad_account_name || meta.ad_account_id || null;
            const noteText = row.reason || meta.reason || meta.note || null;
            return (
              <div key={row.id} className="rounded-lg border bg-card p-3 text-xs space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${kind.badgeClass} inline-flex items-center gap-1`}>
                    {kind.Icon && <kind.Icon className="h-3 w-3" />}
                    {kind.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {format(new Date(row.created_at), "dd MMM HH:mm")}
                  </span>
                </div>
                <div className={`text-lg font-bold ${kind.amountClass}`}>
                  {sign}{fmt(amount)}
                </div>
                {noteText ? (
                  <p className="text-[11px] italic text-muted-foreground border-l-2 border-primary/40 pl-2">
                    Note: {noteText}
                  </p>
                ) : (
                  <p className="text-[11px] italic text-muted-foreground/60">No note</p>
                )}
                {accountName && (
                  <p className="text-[11px]"><span className="text-muted-foreground">Ad Account:</span> {accountName}</p>
                )}
                <div className="grid grid-cols-3 gap-2 border-t pt-2">
                  <div><p className="text-[9px] uppercase text-muted-foreground">Limit</p><p className="font-semibold">{fmt(Number(row.system_limit_after || 0))}</p></div>
                  <div><p className="text-[9px] uppercase text-muted-foreground">Used</p><p className="font-semibold">{fmt(Number(row.total_used_after || 0))}</p></div>
                  <div><p className="text-[9px] uppercase text-muted-foreground">Remaining</p><p className="font-semibold">{fmt(Number(row.remaining_after || 0))}</p></div>
                </div>
                <p className="text-[9px] text-muted-foreground truncate" title={row.idempotency_key || row.source || ""}>
                  {row.source || "master"}{row.source_id ? ` · ${row.source_id}` : ""}
                </p>
              </div>
            );
          })}
          {(!masterLedger || masterLedger.length === 0) && (
            <p className="text-xs text-muted-foreground text-center py-6">Master ledger entry nei akhono.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm sm:text-base">Local Forward Audit</CardTitle>
          <CardDescription className="text-xs">
            Tenant theke master-e report pathanor local audit — delivery/status debug er jonno.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {/* Mobile cards */}
          <div className="sm:hidden space-y-3 px-3">
            {(auditRows || []).map((row: any) => {
              const kind = classifyRow(row.action, row.source);
              const amt = Number(row.amount || 0);
              const localAfter = Number(row.local_total_used_after ?? 0);
              const rowRemaining = systemLimit - localAfter;
              const sign = kind.sign;
              const signStr = sign === -1 ? "−" : sign === 1 ? "+" : "";
              return (
                <div key={row.id} className="border rounded-lg p-3 space-y-2 bg-card">
                  <div className="flex justify-between items-center gap-2">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${kind.badgeClass} flex items-center gap-1`}>
                      {kind.Icon && <kind.Icon className="h-3 w-3" />}
                      {kind.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {format(new Date(row.created_at), "dd MMM HH:mm")}
                    </span>
                  </div>
                  <div className={`text-lg font-bold ${kind.amountClass}`}>
                    {signStr}{fmt(amt)}
                  </div>
                  <div className="border-t pt-2 space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">System Limit</span>
                      <span className="font-medium">{fmt(systemLimit)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Remaining</span>
                      <span className={`font-medium ${rowRemaining < 0 ? "text-destructive" : rowRemaining < systemLimit * 0.2 ? "text-yellow-600" : "text-foreground"}`}>
                        {fmt(rowRemaining)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {row.master_duplicate && <Badge variant="secondary" className="text-[9px]">duplicate</Badge>}
                    {row.error_message ? (
                      <Badge variant="destructive" className="text-[9px]" title={row.error_message}>error</Badge>
                    ) : row.response_status ? (
                      <Badge variant="outline" className="text-[9px]">{row.response_status}</Badge>
                    ) : null}
                    <span className="text-[9px] text-muted-foreground ml-auto truncate max-w-[60%]" title={row.idempotency_key || ""}>
                      {row.source}
                    </span>
                  </div>
                  {row.error_message && (
                    <div className="text-[10px] text-destructive truncate" title={row.error_message}>
                      {row.error_message}
                    </div>
                  )}
                </div>
              );
            })}
            {(!auditRows || auditRows.length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-6">Kono audit entry nei akhono.</p>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">System Limit</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(auditRows || []).map((row: any) => {
                  const kind = classifyRow(row.action, row.source);
                  const amt = Number(row.amount || 0);
                  const localAfter = Number(row.local_total_used_after ?? 0);
                  const rowRemaining = systemLimit - localAfter;
                  const sign = kind.sign;
                  const signStr = sign === -1 ? "−" : sign === 1 ? "+" : "";
                  return (
                    <TableRow key={row.id} className={row.error_message ? "bg-destructive/5" : ""}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(new Date(row.created_at), "dd MMM HH:mm:ss")}
                      </TableCell>
                      <TableCell>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${kind.badgeClass} inline-flex items-center gap-1`}>
                          {kind.Icon && <kind.Icon className="h-3 w-3" />}
                          {kind.label}
                        </span>
                      </TableCell>
                      <TableCell className={`text-right font-semibold ${kind.amountClass}`}>
                        {signStr}{fmt(amt)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium">
                        {fmt(systemLimit)}
                      </TableCell>
                      <TableCell className={`text-right text-xs font-medium ${rowRemaining < 0 ? "text-destructive" : rowRemaining < systemLimit * 0.2 ? "text-yellow-600" : ""}`}>
                        {fmt(rowRemaining)}
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground max-w-[160px] truncate" title={row.idempotency_key || row.source || ""}>
                        {row.source || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {row.master_duplicate && <Badge variant="secondary" className="text-[9px]">duplicate</Badge>}
                          {row.error_message ? (
                            <Badge variant="destructive" className="text-[9px]" title={row.error_message}>error</Badge>
                          ) : row.response_status ? (
                            <Badge variant="outline" className="text-[9px]">{row.response_status}</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!auditRows || auditRows.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground text-sm py-8">
                      Kono audit entry nei akhono.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
