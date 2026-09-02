import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { MaintenanceGate } from "@/components/MaintenanceGate";
import { CompleteProfileGate } from "@/components/CompleteProfileGate";
import { Clock } from "lucide-react";

export function ProtectedGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    if (!loading && !user) {
      void supabase.auth.getSession().then(({ data: { session } }) => {
        if (!cancelled && !session?.user) {
          navigate({ to: "/auth", replace: true });
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [user, loading, navigate]);

  // Profile/role hydration may be slow even after the auth session is known.
  // Only block the route while we still do not know whether a user exists;
  // authenticated children can render their own data-loading/error state.
  if (loading && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  if (profile?.status === "pending") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full text-center">
          <CardContent className="p-8 space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <Clock className="h-8 w-8 text-amber-600" />
            </div>
            <h2 className="text-xl font-bold">Account Pending Approval</h2>
            <p className="text-muted-foreground">
              Your account has been created. Please wait for an admin to approve before you can access the platform.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <MaintenanceGate>
      <CompleteProfileGate>{children}</CompleteProfileGate>
    </MaintenanceGate>
  );
}
