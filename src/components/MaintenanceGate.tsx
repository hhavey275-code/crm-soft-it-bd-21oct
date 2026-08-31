import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wrench, RefreshCw } from "lucide-react";

export const MAINTENANCE_KEYS = {
  mode: "maintenance_mode",
  message: "maintenance_message",
} as const;

export function useMaintenanceMode() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["maintenance-mode"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("key, value")
        .in("key", [MAINTENANCE_KEYS.mode, MAINTENANCE_KEYS.message]);
      const rows = data || [];
      return {
        enabled: rows.find((r) => r.key === MAINTENANCE_KEYS.mode)?.value === "on",
        message: rows.find((r) => r.key === MAINTENANCE_KEYS.message)?.value || "",
      };
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    enabled: data?.enabled ?? false,
    message: data?.message ?? "",
    loading: isLoading,
    refetch,
  };
}

/**
 * Blocks every non-admin user while maintenance mode is on, so updates can be
 * deployed without clients running top-ups / money operations mid-deploy.
 */
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  const { enabled, message, refetch } = useMaintenanceMode();

  if (!enabled || isAdmin) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardContent className="space-y-4 p-8">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Wrench className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-foreground">System Update Chalche</h1>
          <p className="text-sm text-muted-foreground">
            {message ||
              "আমরা এখন system update করছি। কিছুক্ষণ পর আবার চেষ্টা করুন — এই সময়ে top up বা অন্য কাজ করা যাবে না, যাতে কোনো ভুল না হয়।"}
          </p>
          <Button variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Recheck
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
