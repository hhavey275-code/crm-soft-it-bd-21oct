import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardBrandIcon } from "@/components/CardBrandIcon";
import { CreditCard, Loader2, ShieldAlert } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Props {
  adAccountId: string;
}

interface SyncedCard {
  funding_source_id: string;
  display_string: string;
  is_primary: boolean;
  detected_at: string;
  source: "live" | "cached";
  admin_label?: string | null;
  bank_name?: string | null;
  holder_name?: string | null;
}

export function AdAccountSyncedCards({ adAccountId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["ad-account-synced-cards", adAccountId],
    queryFn: async () => {
      // Strategy: union of (currently-attached cards derived from events)
      // ∪ (last-known snapshot cards). This way, once a card is seen on
      // an account it stays visible until an admin manually removes it
      // from the vault — even if Meta later hides it (account disabled,
      // hacked, access lost, etc.).
      const [eventsRes, snapRes] = await Promise.all([
        (supabase as any)
          .from("ad_account_card_assignments")
          .select(
            "funding_source_id, display_string, is_primary, event_type, detected_at, ad_account_cards(admin_label, bank_name, holder_name, display_string)",
          )
          .eq("ad_account_id", adAccountId)
          .order("detected_at", { ascending: false }),
        (supabase as any)
          .from("ad_account_last_known_state")
          .select("cards, last_synced_at, last_sync_error")
          .eq("ad_account_id", adAccountId)
          .maybeSingle(),
      ]);
      if (eventsRes.error) throw eventsRes.error;
      const events = eventsRes.data ?? [];
      const snap = snapRes.data;

      // Derive latest event per funding_source_id
      const latestByFs = new Map<string, any>();
      for (const ev of events) {
        if (!latestByFs.has(ev.funding_source_id)) latestByFs.set(ev.funding_source_id, ev);
      }

      const cardMap = new Map<string, SyncedCard>();

      // Add currently-attached cards (latest event != detached)
      for (const ev of latestByFs.values()) {
        if (ev.event_type === "detached") continue;
        const meta = ev.ad_account_cards;
        cardMap.set(ev.funding_source_id, {
          funding_source_id: ev.funding_source_id,
          display_string: ev.display_string || meta?.display_string || `Card ...${ev.funding_source_id.slice(-4)}`,
          is_primary: !!ev.is_primary,
          detected_at: ev.detected_at,
          source: "live",
          admin_label: meta?.admin_label,
          bank_name: meta?.bank_name,
          holder_name: meta?.holder_name,
        });
      }

      // Add cached snapshot cards (only if not already in live set)
      const snapCards = Array.isArray(snap?.cards) ? snap.cards : [];
      const fsIdsToEnrich = snapCards
        .map((c: any) => String(c?.id ?? ""))
        .filter((id: string) => id && !cardMap.has(id));

      let metaByFs: Record<string, any> = {};
      if (fsIdsToEnrich.length) {
        const { data: vaultRows } = await (supabase as any)
          .from("ad_account_cards")
          .select("funding_source_id, admin_label, bank_name, holder_name, display_string")
          .in("funding_source_id", fsIdsToEnrich);
        for (const r of vaultRows ?? []) metaByFs[r.funding_source_id] = r;
      }

      for (const c of snapCards) {
        const fsId = String(c?.id ?? "");
        if (!fsId || cardMap.has(fsId)) continue;
        const meta = metaByFs[fsId];
        cardMap.set(fsId, {
          funding_source_id: fsId,
          display_string: c?.display_string || meta?.display_string || `Card ...${fsId.slice(-4)}`,
          is_primary: !!c?.is_primary,
          detected_at: snap?.last_synced_at || new Date().toISOString(),
          source: "cached",
          admin_label: meta?.admin_label,
          bank_name: meta?.bank_name,
          holder_name: meta?.holder_name,
        });
      }

      // Also include vault cards that came from any prior event (detached etc.)
      // so an admin still sees them — only suppressed if NO record exists
      // anywhere.
      for (const ev of latestByFs.values()) {
        if (cardMap.has(ev.funding_source_id)) continue;
        const meta = ev.ad_account_cards;
        cardMap.set(ev.funding_source_id, {
          funding_source_id: ev.funding_source_id,
          display_string: ev.display_string || meta?.display_string || `Card ...${ev.funding_source_id.slice(-4)}`,
          is_primary: false,
          detected_at: ev.detected_at,
          source: "cached",
          admin_label: meta?.admin_label,
          bank_name: meta?.bank_name,
          holder_name: meta?.holder_name,
        });
      }

      const cards = Array.from(cardMap.values()).sort((a, b) => {
        if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
        if (a.source !== b.source) return a.source === "live" ? -1 : 1;
        return new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime();
      });

      const anyLive = cards.some((c) => c.source === "live");
      return {
        cards,
        cached: !anyLive && cards.length > 0,
        lastSyncError: snap?.last_sync_error ?? null,
      };
    },
    enabled: !!adAccountId,
  });

  const cards = data?.cards ?? [];
  const isCached = data?.cached;

  return (
    <Card className="border-primary/20">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <CreditCard className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
              Synced Payment Methods
              {cards.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                  {cards.length} {cards.length === 1 ? "card" : "cards"}
                </Badge>
              )}
              {isCached && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-500/40 text-amber-600 dark:text-amber-400">
                  cached
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {isCached
                ? "Account currently unreachable — showing last known cards."
                : "Live data from the most recent sync."}
            </div>
          </div>
        </div>

        {isCached && data?.lastSyncError && (
          <div className="flex items-start gap-2 mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span className="break-all">{data.lastSyncError}</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : cards.length > 0 ? (
          <div className="space-y-2">
            {cards.map((card) => {
              const friendly = card.admin_label || card.bank_name || card.holder_name;
              return (
                <div key={card.funding_source_id} className="flex items-center justify-between p-2.5 rounded-md bg-muted/40 border gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CardBrandIcon displayString={card.display_string} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{friendly || card.display_string}</span>
                        {card.is_primary && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">Primary</Badge>}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {friendly ? card.display_string + " · " : ""}{card.source === "cached" ? "last seen" : "synced"}{" "}
                        {formatDistanceToNow(new Date(card.detected_at), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-2">
            No cards synced yet. Run an account sync (or open the Chrome extension on the billing page) to populate cards.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
