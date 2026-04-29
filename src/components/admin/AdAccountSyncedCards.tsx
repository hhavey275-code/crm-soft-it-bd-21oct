import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardBrandIcon } from "@/components/CardBrandIcon";
import { CreditCard, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Props {
  adAccountId: string;
}

interface SyncedCard {
  funding_source_id: string;
  display_string: string;
  is_primary: boolean;
  detected_at: string;
  admin_label?: string | null;
  bank_name?: string | null;
  holder_name?: string | null;
}

export function AdAccountSyncedCards({ adAccountId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["ad-account-synced-cards", adAccountId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ad_account_card_assignments")
        .select("funding_source_id, display_string, is_primary, detected_at, ad_account_cards(admin_label, bank_name, holder_name, display_string)")
        .eq("ad_account_id", adAccountId)
        .order("is_primary", { ascending: false })
        .order("detected_at", { ascending: false });
      if (error) throw error;
      // Dedupe by funding_source_id (keep first/primary)
      const seen = new Set<string>();
      const cards: SyncedCard[] = [];
      (data ?? []).forEach((row: any) => {
        if (seen.has(row.funding_source_id)) return;
        seen.add(row.funding_source_id);
        const meta = row.ad_account_cards;
        cards.push({
          funding_source_id: row.funding_source_id,
          display_string: row.display_string || meta?.display_string || "Unknown card",
          is_primary: row.is_primary,
          detected_at: row.detected_at,
          admin_label: meta?.admin_label,
          bank_name: meta?.bank_name,
          holder_name: meta?.holder_name,
        });
      });
      return cards;
    },
    enabled: !!adAccountId,
  });

  return (
    <Card className="border-primary/20">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <CreditCard className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-medium">Synced Payment Methods</div>
            <div className="text-xs text-muted-foreground">From Chrome extension sync</div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : data && data.length > 0 ? (
          <div className="space-y-2">
            {data.map((card) => {
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
                        {friendly ? card.display_string : "Unlabeled"} · synced {formatDistanceToNow(new Date(card.detected_at), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-2">
            No cards synced yet. Open the Chrome extension popup on an ad account billing page to sync card info.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
