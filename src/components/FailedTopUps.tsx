import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, Trash2, AlertTriangle } from "lucide-react";
import { friendlyEdgeError } from "@/lib/utils";
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";

export function FailedTopUps() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const isAdminUser = isAdmin || isSuperAdmin;

  const { data: failedTopups = [], isLoading } = useQuery({
    queryKey: ["failed-topups", user?.id],
    queryFn: async () => {
      let query = (supabase as any).from("failed_topups").select("*, ad_accounts(account_name, account_id)").eq("status", "pending").order("created_at", { ascending: false });
      if (!isAdminUser) {
        query = query.eq("user_id", user!.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  // Fetch profile names for admin view
  const { data: profiles = [] } = useQuery({
    queryKey: ["failed-topup-profiles"],
    queryFn: async () => {
      const userIds = [...new Set(failedTopups.map((ft: any) => ft.user_id))] as string[];
      if (userIds.length === 0) return [];
      const { data } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", userIds);
      return data ?? [];
    },
    enabled: isAdminUser && failedTopups.length > 0,
  });

  const getClientName = (userId: string) => {
    const p = profiles.find((p: any) => p.user_id === userId);
    return p?.full_name || p?.email || "Unknown";
  };

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("failed-topups-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "failed_topups" }, () => {
        queryClient.invalidateQueries({ queryKey: ["failed-topups"] });
        queryClient.invalidateQueries({ queryKey: ["sidebar-failed-topups"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, queryClient]);

  const retryMutation = useMutation({
    mutationFn: async (failedTopupId: string) => {
      const { data, error } = await supabase.functions.invoke("retry-failed-topup", {
        body: { failed_topup_id: failedTopupId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Spend cap updated to $${Number(data.new_spend_cap).toLocaleString()}`);
      queryClient.invalidateQueries({ queryKey: ["failed-topups"] });
      queryClient.invalidateQueries({ queryKey: ["client-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["sidebar-failed-topups"] });
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
  });

  const refundMutation = useMutation({
    mutationFn: async (failedTopupId: string) => {
      const { data, error } = await supabase.functions.invoke("resolve-failed-topup", {
        body: { failed_topup_id: failedTopupId, action: "refund" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`$${Number(data.refunded_amount).toLocaleString()} refunded to wallet`);
      queryClient.invalidateQueries({ queryKey: ["failed-topups"] });
      queryClient.invalidateQueries({ queryKey: ["client-wallet"] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-wallets"] });
      queryClient.invalidateQueries({ queryKey: ["client-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["sidebar-failed-topups"] });
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
  });

  if (isLoading) return null;
  if (failedTopups.length === 0) return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          Failed Top-Ups
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">No failed top-ups</p>
      </CardContent>
    </Card>
  );

  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Failed Top-Ups ({failedTopups.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {failedTopups.map((ft: any) => (
          <div key={ft.id} className="flex flex-col gap-2 p-3 rounded-lg border bg-background">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {ft.ad_accounts?.account_name || "Unknown Account"}
                </p>
                <p className="text-xs text-muted-foreground font-mono">
                  {ft.ad_accounts?.account_id?.replace(/^act_/, '') || ""}
                </p>
                {isAdminUser && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Client: {getClientName(ft.user_id)}
                  </p>
                )}
              </div>
              <Badge variant="destructive" className="shrink-0">
                ${Number(ft.amount).toLocaleString()}
              </Badge>
            </div>
            <p className="text-xs text-destructive line-clamp-2">{ft.error_message}</p>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {format(new Date(ft.created_at), "dd MMM yyyy, hh:mm a")}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs gap-1"
                  disabled={retryMutation.isPending}
                  onClick={() => retryMutation.mutate(ft.id)}
                >
                  <RefreshCw className={`h-3 w-3 ${retryMutation.isPending ? "animate-spin" : ""}`} />
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                  disabled={refundMutation.isPending}
                  onClick={() => refundMutation.mutate(ft.id)}
                >
                  <Trash2 className="h-3 w-3" />
                  Refund
                </Button>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
