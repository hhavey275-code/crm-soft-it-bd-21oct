import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Lock } from "lucide-react";

interface Props {
  accountId: string;
  compact?: boolean;
}

interface HoldRow {
  meta_hold_detected: boolean | null;
  meta_hold_reason: string | null;
  meta_account_status: number | null;
  meta_disable_reason: number | null;
  meta_health_checked_at: string | null;
}

export function HoldBadge({ accountId, compact }: Props) {
  const [row, setRow] = useState<HoldRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await (supabase as any)
        .from("ad_accounts")
        .select("meta_hold_detected, meta_hold_reason, meta_account_status, meta_disable_reason, meta_health_checked_at")
        .eq("id", accountId)
        .maybeSingle();
      if (!cancelled) setRow(data ?? null);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [accountId]);

  if (!row?.meta_hold_detected) return null;
  const label = row.meta_hold_reason || "Account on hold";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className="bg-destructive text-destructive-foreground gap-1 text-xs">
            <Lock className="w-3 h-3" />
            {compact ? "Hold" : label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs space-y-1 max-w-xs">
            <div className="font-semibold">Meta says this account is held</div>
            <div>{label}</div>
            {row.meta_account_status !== null && <div>Meta status: <b>{row.meta_account_status}</b></div>}
            {row.meta_disable_reason ? <div>Disable reason: <b>{row.meta_disable_reason}</b></div> : null}
            {row.meta_health_checked_at && (
              <div className="text-muted-foreground pt-1">Checked {new Date(row.meta_health_checked_at).toLocaleString()}</div>
            )}
            <div className="text-muted-foreground pt-1">
              Common cause: card declined when Meta tried to place a temporary hold, or account flagged for risk review. Top-up may still appear successful but ads won't deliver.
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
