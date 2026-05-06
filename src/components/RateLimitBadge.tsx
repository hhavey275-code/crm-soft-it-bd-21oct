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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await (supabase as any)
        .from("ad_account_rate_limits")
        .select("*")
        .eq("ad_account_id", accountId)
        .maybeSingle();
      if (!cancelled) {
        setRow(data ?? null);
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [accountId]);

  if (loading) return <Badge variant="outline" className="text-xs">…</Badge>;
  if (!row) return <Badge variant="outline" className="text-xs text-muted-foreground">No data</Badge>;

  const callPct = Number(row.buc_call_count ?? 0);
  const cpuPct = Number(row.buc_cputime ?? 0);
  const timePct = Number(row.buc_total_time ?? 0);
  const accPct = Number(row.acc_util_pct ?? 0);
  const score = Math.max(callPct, cpuPct, timePct, accPct);
  const blocked = score >= 100 || (row.estimated_regain_sec ?? 0) > 0;
  const regain = formatMin(row.estimated_regain_sec);
  const stale = (Date.now() - new Date(row.updated_at).getTime()) > 2 * 60 * 60 * 1000;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className={`text-xs font-medium ${stale ? "bg-muted text-muted-foreground" : colorClass(score)}`}>
            {blocked
              ? `🔴 ${regain ? `${regain} block` : "Blocked"}`
              : compact
                ? `${Math.round(score)}%`
                : `Rate ${Math.round(score)}%`}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1 text-xs">
            <div className="font-semibold">Meta Rate Limit</div>
            <div>BUC call_count: <b>{callPct.toFixed(1)}%</b></div>
            <div>BUC cputime: <b>{cpuPct.toFixed(1)}%</b></div>
            <div>BUC total_time: <b>{timePct.toFixed(1)}%</b></div>
            <div>Account util: <b>{accPct.toFixed(2)}%</b></div>
            <div>Tier: <b>{row.access_tier || "unknown"}</b></div>
            {regain && <div>Resets in: <b>{regain}</b></div>}
            <div className="text-muted-foreground pt-1">Updated {new Date(row.updated_at).toLocaleTimeString()}</div>
            {stale && <div className="text-muted-foreground">⚠ Stale (&gt;2h old)</div>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
