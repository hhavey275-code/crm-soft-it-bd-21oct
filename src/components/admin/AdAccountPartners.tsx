import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Users, Trash2, RefreshCw } from "lucide-react";

interface Partner {
  bm_id: string;
  name: string;
}

interface Props {
  adAccountId: string;
}

export function AdAccountPartners({ adAccountId }: Props) {
  const queryClient = useQueryClient();
  const [removingPartner, setRemovingPartner] = useState<Partner | null>(null);

  const { data: partners, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["ad-account-partners", adAccountId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("manage-ad-account-partners", {
        body: { action: "list", ad_account_id: adAccountId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.partners ?? []) as Partner[];
    },
    enabled: !!adAccountId,
  });

  const removeMutation = useMutation({
    mutationFn: async (partnerBmId: string) => {
      const { data, error } = await supabase.functions.invoke("manage-ad-account-partners", {
        body: { action: "remove", ad_account_id: adAccountId, partner_bm_id: partnerBmId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, partnerBmId) => {
      toast.success("Partner BM removed successfully");
      setRemovingPartner(null);
      queryClient.invalidateQueries({ queryKey: ["ad-account-partners", adAccountId] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to remove partner");
      setRemovingPartner(null);
    },
  });

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Partner Business Managers
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !partners || partners.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No partner BMs found for this ad account.
            </p>
          ) : (
            <div className="space-y-2">
              {partners.map((partner) => (
                <div
                  key={partner.bm_id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{partner.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      ID: {partner.bm_id}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setRemovingPartner(partner)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!removingPartner} onOpenChange={(o) => !o && setRemovingPartner(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Partner BM?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{removingPartner?.name}</strong> (ID: {removingPartner?.bm_id}) as a partner from this ad account? This action will be applied on Meta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removingPartner && removeMutation.mutate(removingPartner.bm_id)}
              disabled={removeMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeMutation.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
