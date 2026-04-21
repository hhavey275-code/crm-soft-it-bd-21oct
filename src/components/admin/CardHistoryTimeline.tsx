import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardBrandIcon } from "@/components/CardBrandIcon";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { History, Loader2, ChevronDown, ChevronUp, Plus, Minus, Star, Camera } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useState } from "react";

interface Props {
  adAccountId: string;
}

const eventMeta = {
  attached: { label: "Attached", icon: Plus, color: "text-emerald-600", bg: "bg-emerald-500/10" },
  detached: { label: "Detached", icon: Minus, color: "text-destructive", bg: "bg-destructive/10" },
  became_primary: { label: "Became Primary", icon: Star, color: "text-amber-600", bg: "bg-amber-500/10" },
  snapshot: { label: "Snapshot", icon: Camera, color: "text-muted-foreground", bg: "bg-muted" },
} as const;

export function CardHistoryTimeline({ adAccountId }: Props) {
  const [open, setOpen] = useState(false);

  const { data: events, isLoading } = useQuery({
    queryKey: ["card-assignment-history", adAccountId],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const { data, error } = await (supabase as any)
        .from("ad_account_card_assignments")
        .select("*, ad_account_cards(admin_label, bank_name, holder_name)")
        .eq("ad_account_id", adAccountId)
        .gte("detected_at", since.toISOString())
        .order("detected_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4" />
                Card History
                {events?.length ? (
                  <span className="text-xs font-normal text-muted-foreground">({events.length} events, last 90d)</span>
                ) : null}
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : !events || events.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No card history yet. Events will appear after the next sync.
              </p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {events.map((ev: any) => {
                  const meta = eventMeta[ev.event_type as keyof typeof eventMeta] ?? eventMeta.snapshot;
                  const Icon = meta.icon;
                  const card = ev.ad_account_cards;
                  return (
                    <div key={ev.id} className="flex items-start gap-3 p-3 border rounded-lg">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.bg}`}>
                        <Icon className={`h-4 w-4 ${meta.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CardBrandIcon displayString={ev.display_string ?? ""} />
                          <span className="text-sm font-medium truncate">{ev.display_string || `Card ...${ev.funding_source_id?.slice(-4) || "?"}`}</span>
                          <Badge variant="outline" className={`text-xs ${meta.color}`}>{meta.label}</Badge>
                          {ev.is_primary && <Badge variant="secondary" className="text-xs">Primary</Badge>}
                        </div>
                        {(card?.admin_label || card?.bank_name) && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {card.admin_label}{card.admin_label && card.bank_name ? " · " : ""}{card.bank_name}
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {format(new Date(ev.detected_at), "MMM d, yyyy h:mm a")} · {formatDistanceToNow(new Date(ev.detected_at), { addSuffix: true })} · by {ev.detected_by}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
