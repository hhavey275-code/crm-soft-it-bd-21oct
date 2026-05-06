import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, AlertTriangle, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Row {
  id: string;
  account_id: string;
  account_name: string;
  status: string;
  business_manager_name?: string | null;
  client_name?: string | null;
  calls_1h: number;
  estimated_call_limit: number | null;
  acc_util_pct: number | null;
  last_error_code: number | null;
  last_error_message: string | null;
  last_error_at: string | null;
  failed_topups_24h: number;
  last_failed_topup_at: string | null;
  meta_hold_detected: boolean;
  meta_hold_reason: string | null;
  meta_account_status: number | null;
  meta_health_checked_at: string | null;
}

type Filter = "all" | "high_calls" | "errors" | "failed_billing" | "suspected_hold";

// Meta error codes that indicate Meta-side flagging / restriction
const HOLD_ERROR_CODES = new Set([17, 368, 1487742, 1885010, 1487390]);

function likelyCause(r: Row): { label: string; color: string } {
  const utilPct = r.estimated_call_limit && r.estimated_call_limit > 0
    ? (r.calls_1h / r.estimated_call_limit) * 100
    : (r.acc_util_pct ?? 0);

  if (r.meta_hold_detected) return { label: `🔒 ${r.meta_hold_reason || "Meta hold"}`, color: "bg-destructive text-destructive-foreground" };
  if (utilPct >= 80) return { label: "🟠 Rate limit", color: "bg-orange-500 text-white" };
  if (r.last_error_code && HOLD_ERROR_CODES.has(r.last_error_code)) {
    return { label: `🔴 Meta flag #${r.last_error_code}`, color: "bg-destructive text-destructive-foreground" };
  }
  if (r.failed_topups_24h > 0 && !r.last_error_code) {
    return { label: "💳 Card / issuer", color: "bg-yellow-500 text-black" };
  }
  if (r.failed_topups_24h > 0 && r.last_error_code) {
    return { label: "⚠ Mixed", color: "bg-orange-500 text-white" };
  }
  return { label: "—", color: "bg-muted text-muted-foreground" };
}

export default function ProblemAccounts() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [openRow, setOpenRow] = useState<Row | null>(null);

  const load = async () => {
    setLoading(true);
    const sinceHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: accounts } = await (supabase as any)
      .from("ad_accounts")
      .select("id, account_id, account_name, status, business_managers(name)")
      .limit(2000);

    const { data: rl } = await (supabase as any)
      .from("ad_account_rate_limits")
      .select("ad_account_id, acc_util_pct, estimated_call_limit");

    const rlMap = new Map<string, any>();
    (rl ?? []).forEach((r: any) => rlMap.set(r.ad_account_id, r));

    const { data: callRows } = await (supabase as any)
      .from("ad_account_call_log")
      .select("ad_account_id")
      .gte("called_at", sinceHour)
      .not("ad_account_id", "is", null)
      .limit(50000);
    const callCount = new Map<string, number>();
    (callRows ?? []).forEach((c: any) => {
      callCount.set(c.ad_account_id, (callCount.get(c.ad_account_id) ?? 0) + 1);
    });

    const { data: errorRows } = await (supabase as any)
      .from("ad_account_call_log")
      .select("ad_account_id, called_at, error_code, error_message, status_code")
      .gte("called_at", since24h)
      .not("error_code", "is", null)
      .not("ad_account_id", "is", null)
      .order("called_at", { ascending: false })
      .limit(5000);
    const lastError = new Map<string, any>();
    (errorRows ?? []).forEach((e: any) => {
      if (!lastError.has(e.ad_account_id)) lastError.set(e.ad_account_id, e);
    });

    const { data: ftRows } = await (supabase as any)
      .from("failed_topups")
      .select("ad_account_id, created_at, status")
      .gte("created_at", since24h)
      .neq("status", "resolved");
    const ftCount = new Map<string, number>();
    const ftLast = new Map<string, string>();
    (ftRows ?? []).forEach((f: any) => {
      ftCount.set(f.ad_account_id, (ftCount.get(f.ad_account_id) ?? 0) + 1);
      const cur = ftLast.get(f.ad_account_id);
      if (!cur || cur < f.created_at) ftLast.set(f.ad_account_id, f.created_at);
    });

    const all: Row[] = (accounts ?? []).map((a: any) => {
      const bm = Array.isArray(a.business_managers) ? a.business_managers[0] : a.business_managers;
      const rlRow = rlMap.get(a.id);
      const err = lastError.get(a.id);
      return {
        id: a.id,
        account_id: a.account_id,
        account_name: a.account_name || a.account_id,
        status: a.status || "unknown",
        business_manager_name: bm?.name ?? null,
        client_name: null,
        calls_1h: callCount.get(a.id) ?? 0,
        estimated_call_limit: rlRow?.estimated_call_limit ?? null,
        acc_util_pct: rlRow?.acc_util_pct ?? null,
        last_error_code: err?.error_code ?? null,
        last_error_message: err?.error_message ?? null,
        last_error_at: err?.called_at ?? null,
        failed_topups_24h: ftCount.get(a.id) ?? 0,
        last_failed_topup_at: ftLast.get(a.id) ?? null,
      };
    });

    const problems = all.filter((r) =>
      r.calls_1h > 0 ||
      r.last_error_code !== null ||
      r.failed_topups_24h > 0 ||
      (r.acc_util_pct ?? 0) > 50
    );

    setRows(problems);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let r = rows;
    if (filter === "high_calls") {
      r = r.filter((x) => {
        if (!x.estimated_call_limit) return (x.acc_util_pct ?? 0) >= 50;
        return x.calls_1h / x.estimated_call_limit >= 0.5;
      });
    } else if (filter === "errors") {
      r = r.filter((x) => x.last_error_code !== null);
    } else if (filter === "failed_billing") {
      r = r.filter((x) => x.failed_topups_24h > 0);
    } else if (filter === "suspected_hold") {
      r = r.filter((x) => x.failed_topups_24h > 0 && x.status === "active");
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((x) => (x.account_name + " " + x.account_id).toLowerCase().includes(q));
    }
    return [...r].sort((a, b) => b.calls_1h - a.calls_1h);
  }, [rows, filter, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-orange-500" />
            Problem Accounts
          </h1>
          <p className="text-sm text-muted-foreground">
            Ad accounts with high API usage, recent errors, or failed billing
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search account..."
              className="pl-8 w-56"
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All problems</SelectItem>
              <SelectItem value="high_calls">High call count</SelectItem>
              <SelectItem value="errors">Recent errors</SelectItem>
              <SelectItem value="failed_billing">Failed billing</SelectItem>
              <SelectItem value="suspected_hold">Suspected hold</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{filtered.length} accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Calls (1h)</TableHead>
                  <TableHead>Last Error</TableHead>
                  <TableHead>Failed Bills (24h)</TableHead>
                  <TableHead>Likely Cause</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      {loading ? "Loading..." : "No problem accounts"}
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((r) => {
                  const cause = likelyCause(r);
                  const limit = r.estimated_call_limit;
                  const utilPct = limit ? Math.round((r.calls_1h / limit) * 100) : 0;
                  const callColor = utilPct >= 80 ? "text-destructive font-semibold" : utilPct >= 50 ? "text-orange-500" : "";
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.account_name}</div>
                        <div className="text-xs text-muted-foreground">{r.account_id}</div>
                        {r.business_manager_name && (
                          <div className="text-xs text-muted-foreground">BM: {r.business_manager_name}</div>
                        )}
                      </TableCell>
                      <TableCell className={callColor}>
                        {r.calls_1h}{limit ? ` / ${limit}` : ""}
                        {limit ? <div className="text-xs text-muted-foreground">{utilPct}%</div> : null}
                      </TableCell>
                      <TableCell>
                        {r.last_error_code ? (
                          <div>
                            <div className="font-mono text-sm">#{r.last_error_code}</div>
                            <div className="text-xs text-muted-foreground line-clamp-1 max-w-[260px]">
                              {r.last_error_message}
                            </div>
                            {r.last_error_at && (
                              <div className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(r.last_error_at), { addSuffix: true })}
                              </div>
                            )}
                          </div>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        {r.failed_topups_24h > 0 ? (
                          <div>
                            <div className="font-semibold text-destructive">{r.failed_topups_24h}</div>
                            {r.last_failed_topup_at && (
                              <div className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(r.last_failed_topup_at), { addSuffix: true })}
                              </div>
                            )}
                          </div>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell><Badge className={cause.color}>{cause.label}</Badge></TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => setOpenRow(r)}>View</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ProblemAccountDrawer row={openRow} onClose={() => setOpenRow(null)} />
    </div>
  );
}

function ProblemAccountDrawer({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const [errors, setErrors] = useState<any[]>([]);
  const [calls, setCalls] = useState<{ hour: string; count: number }[]>([]);
  const [failed, setFailed] = useState<any[]>([]);

  useEffect(() => {
    if (!row) return;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    (async () => {
      const [{ data: errs }, { data: callRows }, { data: ft }] = await Promise.all([
        (supabase as any).from("ad_account_call_log")
          .select("called_at, endpoint, status_code, error_code, error_subcode, error_message")
          .eq("ad_account_id", row.id)
          .not("error_code", "is", null)
          .gte("called_at", since)
          .order("called_at", { ascending: false })
          .limit(50),
        (supabase as any).from("ad_account_call_log")
          .select("called_at")
          .eq("ad_account_id", row.id)
          .gte("called_at", since)
          .limit(50000),
        (supabase as any).from("failed_topups")
          .select("created_at, amount, error_message, status, last_attempt_via, last_attempt_ip")
          .eq("ad_account_id", row.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      setErrors(errs ?? []);
      setFailed(ft ?? []);
      const buckets = new Map<string, number>();
      (callRows ?? []).forEach((c: any) => {
        const d = new Date(c.called_at);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:00`;
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      });
      const arr = Array.from(buckets.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([hour, count]) => ({ hour, count }));
      setCalls(arr);
    })();
  }, [row]);

  if (!row) return null;
  const max = Math.max(1, ...calls.map((c) => c.count));

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{row.account_name}</SheetTitle>
          <div className="text-xs text-muted-foreground">{row.account_id}</div>
        </SheetHeader>

        <div className="mt-4 space-y-6">
          <section>
            <h3 className="font-semibold mb-2">Calls per hour (last 24h)</h3>
            {calls.length === 0 ? (
              <div className="text-sm text-muted-foreground">No calls logged</div>
            ) : (
              <div className="flex items-end gap-1 h-32 border-b">
                {calls.map((c) => (
                  <div key={c.hour} className="flex-1 flex flex-col items-center gap-1" title={`${c.hour}: ${c.count}`}>
                    <div className="w-full bg-primary rounded-t" style={{ height: `${(c.count / max) * 100}%`, minHeight: 2 }} />
                    <div className="text-[10px] text-muted-foreground rotate-45 origin-left whitespace-nowrap">{c.hour.slice(11, 13)}h</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="font-semibold mb-2">Recent Meta errors ({errors.length})</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {errors.length === 0 ? (
                <div className="text-sm text-muted-foreground">No errors in last 24h</div>
              ) : errors.map((e, i) => (
                <div key={i} className="text-xs border rounded p-2">
                  <div className="flex justify-between">
                    <span className="font-mono font-semibold">#{e.error_code}{e.error_subcode ? `/${e.error_subcode}` : ""}</span>
                    <span className="text-muted-foreground">{formatDistanceToNow(new Date(e.called_at), { addSuffix: true })}</span>
                  </div>
                  <div className="text-muted-foreground mt-1">{e.endpoint}</div>
                  <div className="mt-1">{e.error_message}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Failed top-ups ({failed.length})</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {failed.length === 0 ? (
                <div className="text-sm text-muted-foreground">None</div>
              ) : failed.map((f, i) => (
                <div key={i} className="text-xs border rounded p-2">
                  <div className="flex justify-between">
                    <span className="font-semibold">${f.amount}</span>
                    <Badge variant={f.status === "resolved" ? "secondary" : "destructive"}>{f.status}</Badge>
                  </div>
                  <div className="text-muted-foreground">{formatDistanceToNow(new Date(f.created_at), { addSuffix: true })}</div>
                  {f.error_message && <div className="mt-1">{f.error_message}</div>}
                  {f.last_attempt_ip && <div className="text-muted-foreground mt-1">IP: {f.last_attempt_ip} via {f.last_attempt_via}</div>}
                </div>
              ))}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
