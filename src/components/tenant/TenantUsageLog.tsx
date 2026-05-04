import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TenantUsageLog() {
  // License snapshot from site_settings (local cached values from heartbeat)
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

  // Live master snapshot
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

  // Audit rows
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

  const refreshAll = () => {
    refetchLicense();
    refetchMaster();
    refetchAudit();
  };

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
        <Button size="sm" variant="outline" onClick={refreshAll} disabled={masterFetching || auditFetching}>
          <RefreshCw className={`h-4 w-4 ${(masterFetching || auditFetching) ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Local Total Used</CardDescription>
            <CardTitle className="text-xl sm:text-2xl">${localTotalUsed.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">Tenant DB cached value</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Master Total Used</CardDescription>
            <CardTitle className="text-xl sm:text-2xl">${masterTotalUsed.toLocaleString()}</CardTitle>
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
              {drift > 0 ? "+" : ""}${drift.toFixed(2)}
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
            <span>Used: ${localTotalUsed.toLocaleString()}</span>
            <span>Limit: ${systemLimit.toLocaleString()}</span>
          </div>
          <Progress value={Math.min(usagePercent, 100)} className="h-3" />
          <div className="flex flex-wrap gap-2 justify-between">
            <Badge variant={remaining > 0 ? "default" : "destructive"}>
              Remaining: ${remaining.toLocaleString()}
            </Badge>
            <span className="text-xs text-muted-foreground">{usagePercent.toFixed(1)}% used</span>
          </div>
        </CardContent>
      </Card>

      {/* Audit table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm sm:text-base">Detailed Audit Log</CardTitle>
          <CardDescription className="text-xs">
            Last 200 entries. Each row = ekta usage report Master ke pathano hoyeche.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {/* Mobile cards */}
          <div className="sm:hidden space-y-2 px-3">
            {(auditRows || []).map((row: any) => (
              <div key={row.id} className="border rounded-lg p-3 text-xs space-y-1">
                <div className="flex justify-between items-start gap-2">
                  <span className="text-muted-foreground">{format(new Date(row.created_at), "dd MMM HH:mm")}</span>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {row.master_duplicate && <Badge variant="secondary" className="text-[9px]">DUP</Badge>}
                    {row.error_message && <Badge variant="destructive" className="text-[9px]">ERR</Badge>}
                    {row.response_status && row.response_status >= 200 && row.response_status < 300 && !row.error_message && (
                      <Badge variant="outline" className="text-[9px]">{row.response_status}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">{row.source}</span>
                  <span className={row.action === "refund-usage" ? "text-green-500" : ""}>
                    {row.action === "refund-usage" ? "-" : "+"}${Number(row.amount).toFixed(2)}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground truncate">key: {row.idempotency_key || "—"}</div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Local: ${Number(row.local_total_used_before ?? 0).toFixed(0)} → ${Number(row.local_total_used_after ?? 0).toFixed(0)}</span>
                  <span>Master: ${Number(row.master_total_used_after ?? 0).toFixed(0)}</span>
                </div>
                {row.error_message && (
                  <div className="text-[10px] text-destructive truncate" title={row.error_message}>
                    {row.error_message}
                  </div>
                )}
              </div>
            ))}
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
                  <TableHead>Source</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Local Before → After</TableHead>
                  <TableHead className="text-right">Master After</TableHead>
                  <TableHead>Idem Key</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(auditRows || []).map((row: any) => {
                  const localDelta = Number(row.local_total_used_after ?? 0) - Number(row.local_total_used_before ?? 0);
                  const masterAfter = row.master_total_used_after !== null ? Number(row.master_total_used_after) : null;
                  const localAfter = Number(row.local_total_used_after ?? 0);
                  const rowDrift = masterAfter !== null ? masterAfter - localAfter : 0;
                  return (
                    <TableRow key={row.id} className={row.error_message ? "bg-destructive/5" : ""}>
                      <TableCell className="text-xs whitespace-nowrap">{format(new Date(row.created_at), "dd MMM HH:mm:ss")}</TableCell>
                      <TableCell className="text-xs">{row.source}</TableCell>
                      <TableCell>
                        <Badge variant={row.action === "refund-usage" ? "secondary" : "outline"} className="text-[10px]">
                          {row.action}
                        </Badge>
                      </TableCell>
                      <TableCell className={`text-right font-medium ${row.action === "refund-usage" ? "text-green-500" : ""}`}>
                        {row.action === "refund-usage" ? "-" : "+"}${Number(row.amount).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        ${Number(row.local_total_used_before ?? 0).toFixed(0)} → ${localAfter.toFixed(0)}
                        <span className="ml-1 text-[10px]">({localDelta >= 0 ? "+" : ""}{localDelta.toFixed(2)})</span>
                      </TableCell>
                      <TableCell className={`text-right text-xs ${Math.abs(rowDrift) > 0.01 ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {masterAfter !== null ? `$${masterAfter.toFixed(0)}` : "—"}
                        {Math.abs(rowDrift) > 0.01 && (
                          <span className="ml-1 text-[10px]">(Δ {rowDrift > 0 ? "+" : ""}{rowDrift.toFixed(2)})</span>
                        )}
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground max-w-[140px] truncate" title={row.idempotency_key || ""}>
                        {row.idempotency_key || "—"}
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
                    <TableCell colSpan={8} className="text-center text-muted-foreground text-sm py-8">
                      Kono audit entry nei akhono. Notun spend cap update / retry hole ekhane dekha jabe.
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
