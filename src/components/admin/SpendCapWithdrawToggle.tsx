import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

/**
 * Info-tab control: allow this client to pull unused ad-account balance back
 * into their wallet (spend cap withdraw) directly from their own dashboard.
 */
export function SpendCapWithdrawToggle({ userId }: { userId: string }) {
  const queryClient = useQueryClient();

  const { data: enabled } = useQuery({
    queryKey: ["spend-cap-withdraw-enabled", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("profiles")
        .select("spend_cap_withdraw_enabled")
        .eq("user_id", userId)
        .maybeSingle();
      return !!data?.spend_cap_withdraw_enabled;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (value: boolean) => {
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ spend_cap_withdraw_enabled: value })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Spend cap withdraw permission updated");
      queryClient.invalidateQueries({ queryKey: ["spend-cap-withdraw-enabled", userId] });
      queryClient.invalidateQueries({ queryKey: ["client-detail-profile", userId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update"),
  });

  return (
    <div className="pt-3 border-t">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Spend Cap Withdraw
          </p>
          <p className="text-xs text-muted-foreground">
            Client can pull unused ad account balance back to their wallet (if Meta allows)
          </p>
        </div>
        <Switch
          checked={!!enabled}
          onCheckedChange={(v) => toggleMutation.mutate(v)}
          disabled={toggleMutation.isPending}
        />
      </div>
    </div>
  );
}
