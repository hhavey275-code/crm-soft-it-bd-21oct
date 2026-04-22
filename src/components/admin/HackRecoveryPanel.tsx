import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardBrandIcon } from "@/components/CardBrandIcon";
import { ShieldAlert, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Props {
  adAccountId: string;
  account: any;
}

/**
 * Shows the last-known state of an ad account when sync is failing or account is hacked/disabled.
 * Surfaces last spend cap, balance, last spend date, last known cards — so admin can call the bank
 * and freeze cards immediately.
 */
export function HackRecoveryPanel({ adAccountId, account }: Props) {
  const { data: lks, isLoading } = useQuery({
    queryKey: ["last-known-state", adAccountId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ad_account_last_known_state")
        .select("*")
        .eq("ad_account_id", adAccountId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: lastCards } = useQuery({
    queryKey: ["last-known-cards", adAccountId],
    queryFn: async () => {
      // Pull a wider history (last 200 events). For each funding_source_id, prefer the most
      // recent NON-detached event so that — even if a recent (possibly bogus) "detached"
      // event was logged when Meta stripped funding info on a disabled account — we still
      // surface the last card the bank should freeze.
      const { data } = await (supabase as any)
        .from("ad_account_card_assignments")
        .select("*, ad_account_cards(admin_label, bank_name, holder_name)")
        .eq("ad_account_id", adAccountId)
        .order("detected_at", { ascending: false })
        .limit(200);
      const lastAttachedPerCard = new Map<string, any>();
      for (const ev of (data ?? []) as any[]) {
        if (ev.event_type === "detached") continue;
        if (!lastAttachedPerCard.has(ev.funding_source_id)) {
          lastAttachedPerCard.set(ev.funding_source_id, ev);
        }
      }
      return Array.from(lastAttachedPerCard.values());
    },
  });

  // Show if: explicit sync error, OR account status is disabled/hold, OR last sync is stale (> 24h)
  const hasError = !!lks?.last_sync_error;
  const isDisabled = account?.status === "disabled" || account?.status === "hold" || account?.status === "unsettled";
  const lastSyncMs = lks?.last_synced_at ? Date.now() - new Date(lks.last_synced_at).getTime() : 0;
  const isStale = lks?.last_synced_at && lastSyncMs > 24 * 60 * 60 * 1000;
  const shouldShow = hasError || isDisabled || isStale;

  if (isLoading || !shouldShow || !lks) return null;

  const cards = (lastCards && lastCards.length > 0) ? lastCards : (Array.isArray(lks.cards) ? lks.cards : []);
  const remainingDollars = Math.max(0, Number(lks.spend_cap ?? 0) - Number(lks.amount_spent ?? 0));

  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-5 w-5" /> Hack Recovery — Last Known State
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {hasError
            ? "Latest sync failed. Showing last successful snapshot."
            : isDisabled
              ? "Account is disabled / on hold. Showing last known state before issue."
              : "No recent successful sync. Showing last known snapshot."}
          {lks.last_synced_at && <> Last synced {formatDistanceToNow(new Date(lks.last_synced_at), { addSuffix: true })}.</>}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {lks.last_sync_error && (
          <div className="rounded-md bg-destructive/10 p-2.5 text-xs font-mono text-destructive border border-destructive/20">
            {lks.last_sync_error}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Spend Cap</div>
            <div className="font-bold">${Number(lks.spend_cap ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Amount Spent</div>
            <div className="font-bold">${Number(lks.amount_spent ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Remaining</div>
            <div className="font-bold text-emerald-600">${remainingDollars.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Last Spend</div>
            <div className="font-bold">{lks.last_spend_date ? new Date(lks.last_spend_date).toLocaleDateString() : "—"}</div>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Last Known Cards (call the bank to freeze)</div>
          {cards.length === 0 ? (
            <p className="text-sm text-muted-foreground">No card history captured.</p>
          ) : (
            <div className="space-y-2">
              {cards.map((c: any, idx: number) => {
                const display = c.display_string || `Card ...${(c.funding_source_id ?? c.id ?? "").slice(-4)}`;
                const meta = c.ad_account_cards;
                return (
                  <div key={c.id ?? c.funding_source_id ?? idx} className="flex items-center justify-between p-2.5 border rounded-lg bg-background">
                    <div className="flex items-center gap-2 min-w-0">
                      <CardBrandIcon displayString={display} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{display}</div>
                        {(meta?.admin_label || meta?.bank_name) && (
                          <div className="text-xs text-muted-foreground truncate">
                            {meta?.admin_label}{meta?.admin_label && meta?.bank_name ? " · " : ""}{meta?.bank_name}
                            {meta?.holder_name ? ` · ${meta.holder_name}` : ""}
                          </div>
                        )}
                      </div>
                    </div>
                    {c.is_primary && <Badge variant="secondary" className="text-xs">Primary</Badge>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
