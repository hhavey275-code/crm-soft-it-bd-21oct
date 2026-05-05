import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gauge, Loader2, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ExtensionSyncButton } from "@/components/ExtensionSyncButton";
import { ClientRequestSyncButton } from "@/components/ClientRequestSyncButton";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  adAccountId: string;
  metaAccountId?: string | null;
}

function fmt(v?: number | null, currency = "USD") {
  if (v === null || v === undefined) return "—";
  return `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function LiveBillingData({ adAccountId, metaAccountId }: Props) {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["live-billing-data", adAccountId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ad_account_insights")
        .select("daily_spend_limit, hidden_daily_limit, billing_threshold, total_spending, outstanding_balance, balance, account_type, timezone_name, daily_spend_limit_currency, daily_spend_limit_synced_at, billing_raw_snapshot, updated_at")
        .eq("ad_account_id", adAccountId)
        .maybeSingle();
      return data;
    },
    enabled: !!adAccountId,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <Card className="border-primary/20"><CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading live billing data…
      </CardContent></Card>
    );
  }
  const cur = data?.daily_spend_limit_currency || "USD";
  const syncedAt = data?.daily_spend_limit_synced_at ? new Date(data.daily_spend_limit_synced_at) : null;
  const synced = syncedAt ? formatDistanceToNow(syncedAt, { addSuffix: true }) : "never";
  const isStale = syncedAt ? Date.now() - syncedAt.getTime() > 60 * 60 * 1000 : true;
  const status = data?.billing_raw_snapshot?.account_status;

  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-emerald-500/10 p-2"><Gauge className="h-5 w-5 text-emerald-600" /></div>
            <div>
              <div className="text-sm font-semibold">Live Billing Data</div>
              <div className="text-[11px] text-muted-foreground">Synced {synced}{status ? ` · ${status}` : ""}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data?.account_type && <Badge variant="secondary" className="text-xs">{data.account_type}</Badge>}
            {isAdmin && metaAccountId && (
              <ExtensionSyncButton
                accountId={metaAccountId}
                size="sm"
                onSynced={() => {
                  queryClient.invalidateQueries({ queryKey: ["live-billing-data", adAccountId] });
                }}
              />
            )}
            {!isAdmin && (
              <ClientRequestSyncButton
                adAccountInternalId={adAccountId}
                onRequested={() => {
                  queryClient.invalidateQueries({ queryKey: ["live-billing-data", adAccountId] });
                }}
              />
            )}
          </div>
        </div>
        {isStale && data && (
          <div className="mb-3 flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Data may be outdated. Click {isAdmin ? "Sync from Meta" : "Request sync"} to refresh.</span>
          </div>
        )}
        {data ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <Field label="Hidden Limit" value={fmt(data.hidden_daily_limit, cur)} accent />
            <Field label="Visible Limit" value={fmt(data.daily_spend_limit, cur)} />
            <Field label="Threshold" value={fmt(data.billing_threshold, cur)} />
            <Field label="Balance" value={fmt(data.balance, cur)} />
            <Field label="Outstanding" value={fmt(data.outstanding_balance, cur)} />
            <Field label="Total spending" value={fmt(data.total_spending, cur)} />
            <Field label="Timezone" value={data.timezone_name || "—"} />
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            No live data yet. Click <span className="font-medium text-foreground">{isAdmin ? "Sync from Meta" : "Request sync"}</span> above to fetch the
            hidden daily limit, threshold, balance and cards.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`font-bold ${accent ? "text-emerald-600" : ""}`}>{value}</div>
    </div>
  );
}
