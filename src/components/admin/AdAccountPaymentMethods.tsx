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

interface Props {
  adAccountId: string;
  currentCards?: { id?: string; display_string: string }[];
  isAdmin?: boolean;
}

export function AdAccountPaymentMethods({ adAccountId, currentCards = [], isAdmin = false }: Props) {
  const queryClient = useQueryClient();
  const [showBmCards, setShowBmCards] = useState(false);

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
  const displayCards = accountCards && accountCards.length > 0 ? accountCards : currentCards;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Payment Methods
            </CardTitle>
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
              {displayCards.map((card, idx) => (
                <div key={card.id || idx} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <CardBrandIcon displayString={card.display_string} />
                    <div>
                      <span className="text-sm font-medium">{card.display_string}</span>
                      {'exp_month' in card && (card as any).exp_month && (card as any).exp_year && (
                        <span className="text-xs text-muted-foreground ml-2">
                          Expires {(card as any).exp_month}/{(card as any).exp_year}
                        </span>
                      )}
                    </div>
                    {idx === 0 && displayCards.length > 1 && (
                      <Badge variant="outline" className="text-xs">Default</Badge>
                    )}
                    {idx > 0 && (
                      <Badge variant="secondary" className="text-xs">Backup</Badge>
                    )}
                  </div>
                  {isAdmin && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (confirm("Remove this payment method from the ad account?")) {
                          removeMutation.mutate(card.id || "");
                        }
                      }}
                      disabled={removeMutation.isPending}
                    >
                      {removeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No payment method linked to this ad account.</p>
          )}
        </CardContent>
      </Card>

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
