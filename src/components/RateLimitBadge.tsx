import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  accountId: string; // ad_accounts.id (uuid)
  compact?: boolean;
}

interface RateLimitRow {
  acc_util_pct: number | null;
  reset_seconds: number | null;
  access_tier: string | null;
  estimated_call_limit: number | null;
  buc_call_count: number | null;
  buc_cputime: number | null;
  buc_total_time: number | null;
  estimated_regain_sec: number | null;
  updated_at: string;
}

function colorClass(score: number) {
  if (score >= 95) return "bg-destructive text-destructive-foreground";
  if (score >= 80) return "bg-orange-500 text-white";
  if (score >= 50) return "bg-yellow-500 text-black";
  return "bg-green-600 text-white";
}

function formatMin(secs: number | null | undefined) {
  if (!secs || secs <= 0) return null;
  if (secs < 60) return `${secs}s`;
  return `${Math.round(secs / 60)}m`;
}

export function RateLimitBadge({ accountId, compact = false }: Props) {
  const [row, setRow] = useState<RateLimitRow | null>(null);
  const [callsLastHour, setCallsLastHour] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const [{ data: rl }, { count }] = await Promise.all([
        (supabase as any)
          .from("ad_account_rate_limits")
          .select("*")
          .eq("ad_account_id", accountId)
          .maybeSingle(),
        (supabase as any)
          .from("ad_account_call_log")
          .select("id", { count: "exact", head: true })
          .eq("ad_account_id", accountId)
          .gte("called_at", sinceIso),
      ]);
      if (!cancelled) {
        setRow(rl ?? null);
        setCallsLastHour(typeof count === "number" ? count : 0);
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [accountId]);

  if (loading) return <Badge variant="outline" className="text-xs">…</Badge>;

  const limit = row?.estimated_call_limit ?? null;
  const callPctHeader = Number(row?.buc_call_count ?? 0);
  const cpuPct = Number(row?.buc_cputime ?? 0);
  const timePct = Number(row?.buc_total_time ?? 0);
  const accPct = Number(row?.acc_util_pct ?? 0);
  const score = Math.max(callPctHeader, cpuPct, timePct, accPct);
  const blocked = score >= 100 || (row?.estimated_regain_sec ?? 0) > 0;
  const regain = formatMin(row?.estimated_regain_sec);
  const stale = row ? (Date.now() - new Date(row.updated_at).getTime()) > 2 * 60 * 60 * 1000 : false;

  // Color by whichever is worse: header % or local count vs estimated limit
  const localPct = limit && limit > 0 ? Math.round((callsLastHour / limit) * 100) : 0;
  const worstPct = Math.max(score, localPct);

  const label = blocked
    ? `🔴 ${regain ? `${regain} block` : "Blocked"}`
    : limit
      ? `${callsLastHour}/${limit}`
      : `${callsLastHour} calls`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className={`text-xs font-medium ${stale && !callsLastHour ? "bg-muted text-muted-foreground" : colorClass(worstPct)}`}>
            {compact ? label : `Calls ${label}`}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1 text-xs">
            <div className="font-semibold">Meta API Usage (last 1h)</div>
            <div>Calls counted: <b>{callsLastHour}</b>{limit ? ` / ${limit}` : ""}</div>
            {limit ? <div>Local utilization: <b>{localPct}%</b></div> : null}
            <div className="border-t pt-1 mt-1 font-semibold">Meta header %</div>
            <div>BUC call_count: <b>{callPctHeader.toFixed(1)}%</b></div>
            <div>BUC cputime: <b>{cpuPct.toFixed(1)}%</b></div>
            <div>BUC total_time: <b>{timePct.toFixed(1)}%</b></div>
            <div>Account util: <b>{accPct.toFixed(2)}%</b></div>
            <div>Tier: <b>{row?.access_tier || "unknown"}</b></div>
            {regain && <div>Resets in: <b>{regain}</b></div>}
            {row && <div className="text-muted-foreground pt-1">Headers updated {new Date(row.updated_at).toLocaleTimeString()}</div>}
            {stale && <div className="text-muted-foreground">⚠ Header stale (&gt;2h)</div>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
