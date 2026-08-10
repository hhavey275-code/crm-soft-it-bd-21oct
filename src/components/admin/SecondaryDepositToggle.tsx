import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

/**
 * Info-tab control: allow this client to deposit a payment directly into the
 * secondary (sheet-rate) wallet. Having a secondary wallet enabled is NOT
 * enough — the admin must explicitly grant deposit permission per client.
 */
export function SecondaryDepositToggle({ userId }: { userId: string }) {
  const queryClient = useQueryClient();

  const { data: enabled } = useQuery({
    queryKey: ["secondary-deposit-enabled", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("profiles")
        .select("secondary_deposit_enabled")
        .eq("user_id", userId)
        .maybeSingle();
      return !!data?.secondary_deposit_enabled;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (value: boolean) => {
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ secondary_deposit_enabled: value })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Secondary wallet deposit permission updated");
      queryClient.invalidateQueries({ queryKey: ["secondary-deposit-enabled", userId] });
      queryClient.invalidateQueries({ queryKey: ["client-detail-profile", userId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update"),
  });

  return (
    <div className="pt-3 border-t">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Secondary Wallet Deposit
          </p>
          <p className="text-xs text-muted-foreground">
            Client can submit a payment that gets credited to the secondary (sheet-rate) wallet
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
