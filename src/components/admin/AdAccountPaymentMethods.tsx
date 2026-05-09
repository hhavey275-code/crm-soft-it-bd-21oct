import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CardBrandIcon } from "@/components/CardBrandIcon";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { EditCardLabelDialog } from "@/components/admin/EditCardLabelDialog";
import { toast } from "sonner";
import { CreditCard, Loader2, Trash2, Plus, Pencil } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Props {
  adAccountId: string;
  currentCards?: { id?: string; display_string: string }[];
  isAdmin?: boolean;
}

export function AdAccountPaymentMethods({ adAccountId, currentCards = [], isAdmin = false }: Props) {
  const queryClient = useQueryClient();
  const [showBmCards, setShowBmCards] = useState(false);
  const [editCard, setEditCard] = useState<any>(null);

  // Friendly labels (admin_label / bank_name / holder_name) keyed by display_string
  const { data: cardMeta } = useQuery({
    queryKey: ["ad-account-cards-meta", adAccountId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ad_account_card_assignments")
        .select("display_string, funding_source_id, ad_account_cards(id, display_string, admin_label, bank_name, holder_name, notes, card_type)")
        .eq("ad_account_id", adAccountId)
        .order("detected_at", { ascending: false })
        .limit(50);
      const map = new Map<string, any>();
      (data ?? []).forEach((row: any) => {
        const card = row.ad_account_cards;
        if (!card) return;
        const key = (row.display_string || card.display_string || "").toLowerCase();
        if (key && !map.has(key)) map.set(key, card);
      });
      return map;
    },
    enabled: !!adAccountId,
  });

  // DB-cached cards from extension sync (primary source — fast & always current)
  const { data: cachedState } = useQuery({
    queryKey: ["account-cached-cards", adAccountId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ad_account_last_known_state")
        .select("cards, last_synced_at")
        .eq("ad_account_id", adAccountId)
        .maybeSingle();
      return {
        cards: (Array.isArray(data?.cards) ? data.cards : []) as { id: string; display_string: string; type?: string; is_primary?: boolean; exp_month?: number; exp_year?: number }[],
        lastSyncedAt: data?.last_synced_at as string | null | undefined,
      };
    },
    enabled: !!adAccountId,
  });
  const cachedCards = cachedState?.cards;
  const lastSyncedAt = cachedState?.lastSyncedAt;


  // Live cards via edge function — used only as fallback when no cached cards exist
  const { data: accountCards, isLoading: loadingCards } = useQuery({
    queryKey: ["account-all-cards", adAccountId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("manage-ad-account-partners", {
        body: { action: "list_account_cards", ad_account_id: adAccountId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.cards ?? []) as { id: string; display_string: string; type: string; exp_month?: number; exp_year?: number }[];
    },
    enabled: !!adAccountId && (!cachedCards || cachedCards.length === 0),
  });

  const { data: bmMethods, isLoading: loadingBmMethods } = useQuery({
    queryKey: ["bm-payment-methods", adAccountId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("manage-ad-account-partners", {
        body: { action: "list_bm_payment_methods", ad_account_id: adAccountId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.methods ?? []) as { id: string; display_string: string; type: string }[];
    },
    enabled: showBmCards,
  });

  const removeMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      const { data, error } = await supabase.functions.invoke("manage-ad-account-partners", {
        body: { action: "remove_funding_source", ad_account_id: adAccountId, payment_method_id: paymentMethodId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Payment method removed");
      queryClient.invalidateQueries({ queryKey: ["account-all-cards", adAccountId] });
      queryClient.invalidateQueries({ queryKey: ["ad-account-insights-detail", adAccountId] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to remove"),
  });

  const assignMutation = useMutation({
    mutationFn: async (fundingSourceId: string) => {
      const { data, error } = await supabase.functions.invoke("manage-ad-account-partners", {
        body: { action: "assign_funding_source", ad_account_id: adAccountId, funding_source_id: fundingSourceId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Card assigned to ad account");
      setShowBmCards(false);
      queryClient.invalidateQueries({ queryKey: ["account-all-cards", adAccountId] });
      queryClient.invalidateQueries({ queryKey: ["ad-account-insights-detail", adAccountId] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to assign card"),
  });

  const assigningMethodId = assignMutation.isPending ? assignMutation.variables : null;
  const rawCards = (cachedCards && cachedCards.length > 0)
    ? cachedCards
    : (accountCards && accountCards.length > 0 ? accountCards : currentCards);
  // Always render the API/primary default card first, then the rest.
  const displayCards = [...rawCards].sort((a: any, b: any) => {
    const ap = a?.is_primary ? 1 : 0;
    const bp = b?.is_primary ? 1 : 0;
    return bp - ap;
  });

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                Payment Methods
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-1">
                {lastSyncedAt
                  ? `Last synced ${formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true })} · cards are stored permanently for recovery`
                  : "Cards are stored permanently for recovery — never auto-deleted"}
              </p>
            </div>
            {isAdmin && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowBmCards(true)}>
                <Plus className="h-3.5 w-3.5" />
                Add Card from BM
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadingCards ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : displayCards.length > 0 ? (
            <div className="space-y-2">
              {displayCards.map((card, idx) => {
                const meta = cardMeta?.get((card.display_string || "").toLowerCase());
                const friendly = meta?.admin_label || meta?.holder_name;
                const brand = meta?.card_type || (card as any).type;
                const brandLabel = brand
                  ? brand.toLowerCase() === "mastercard" ? "Mastercard"
                    : brand.toLowerCase() === "visa" ? "Visa"
                    : brand.toLowerCase() === "amex" ? "Amex"
                    : brand.charAt(0).toUpperCase() + brand.slice(1)
                  : null;
                const bank = meta?.bank_name;
                const last4 = (card.display_string || "").match(/(\d{4})\s*$/)?.[1];
                return (
                  <div key={card.id || idx} className="flex items-center justify-between p-3 border rounded-lg gap-2">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <CardBrandIcon displayString={card.display_string} brand={brand} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">
                            {brandLabel ? `${brandLabel} •••• ${last4 || ""}`.trim() : card.display_string}
                          </span>
                          {bank && <Badge variant="outline" className="text-xs">{bank}</Badge>}
                          {idx === 0 && displayCards.length > 1 && (
                            <Badge variant="outline" className="text-xs">Default</Badge>
                          )}
                          {idx > 0 && (
                            <Badge variant="secondary" className="text-xs">Backup</Badge>
                          )}
                          {!brandLabel && (
                            <Badge variant="destructive" className="text-[10px]">Brand unknown — click ✎ to set</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {friendly || (brandLabel ? card.display_string : "Unlabeled card")}
                          {'exp_month' in card && (card as any).exp_month && (card as any).exp_year && (
                            <span className="ml-2">· Exp {(card as any).exp_month}/{(card as any).exp_year}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        {meta && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => setEditCard(meta)}
                            title="Edit label"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {/* Card removal moved to the extension's billing-page panel.
                            Open the Meta billing page for this account and remove the
                            card from there — it uses your active Facebook session and
                            shows Meta's native confirmation dialog. */}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No payment method linked to this ad account.</p>
          )}
        </CardContent>
      </Card>

      <EditCardLabelDialog
        card={editCard}
        open={!!editCard}
        onOpenChange={(o) => !o && setEditCard(null)}
      />

      <Dialog open={showBmCards} onOpenChange={setShowBmCards}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Card from Business Manager</DialogTitle>
            <DialogDescription>
              BM এ আগে থেকে যে cards আছে সেগুলো থেকে select করুন
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {loadingBmMethods ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : bmMethods && bmMethods.length > 0 ? (
              bmMethods.map((method) => (
                <div key={method.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <CardBrandIcon displayString={method.display_string} />
                    <div>
                      <span className="text-sm font-medium">{method.display_string}</span>
                      <span className="text-xs text-muted-foreground ml-2 capitalize">{method.type}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => assignMutation.mutate(method.id)}
                    disabled={assignMutation.isPending}
                  >
                    {assignMutation.isPending && assigningMethodId === method.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Assign"}
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No payment methods found in Business Manager.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
