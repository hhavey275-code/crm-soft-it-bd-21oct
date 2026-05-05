import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  /** Internal ad_accounts.id (uuid) */
  adAccountInternalId: string;
  size?: "icon" | "sm";
  className?: string;
  onRequested?: () => void;
}

/**
 * Sync button for users WITHOUT the extension (clients).
 * Inserts a sync request that admin's extension picks up.
 */
export function ClientRequestSyncButton({ adAccountInternalId, size = "sm", className, onRequested }: Props) {
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const { data: pending } = useQuery({
    queryKey: ["sync-request-pending", adAccountInternalId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ad_account_sync_requests")
        .select("id, status, requested_at, completed_at, error")
        .eq("ad_account_id", adAccountInternalId)
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!adAccountInternalId,
    refetchInterval: pending => (pending.state.data?.status === "pending" ? 8000 : 30000),
  });

  // When a pending request flips to done, refresh live billing
  useEffect(() => {
    if (pending?.status === "done") {
      queryClient.invalidateQueries({ queryKey: ["live-billing-data"] });
    }
  }, [pending?.status, queryClient]);

  const isPending = pending?.status === "pending";

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setBusy(true);
    const t = toast.loading("Sending sync request to admin…");
    try {
      const { data, error } = await (supabase.functions as any).invoke("request-account-sync", {
        body: { ad_account_id: adAccountInternalId },
      });
      if (error || data?.error) throw new Error(data?.error || error.message);
      toast.success("Sync requested. Admin will refresh shortly.", { id: t });
      queryClient.invalidateQueries({ queryKey: ["sync-request-pending", adAccountInternalId] });
      onRequested?.();
    } catch (err: any) {
      toast.error(err?.message || "Could not request sync", { id: t });
    } finally {
      setBusy(false);
    }
  };

  const label = isPending ? "Waiting for admin…" : busy ? "Requesting…" : "Request sync";
  const Icon = isPending ? Clock : RefreshCw;

  const button = (
    <Button
      variant={isPending ? "secondary" : "outline"}
      size="sm"
      className={className}
      disabled={busy || isPending}
      onClick={handleClick}
    >
      <Icon className={`h-3.5 w-3.5 mr-1 ${busy ? "animate-spin" : ""}`} />
      {label}
    </Button>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          {isPending
            ? "Admin has been notified. Data refreshes automatically when synced."
            : "Ask admin to refresh live billing data for this account."}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
