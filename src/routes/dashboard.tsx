import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { RefreshCw, WifiOff } from "lucide-react";

const AdminDashboard = lazy(() =>
  import("@/components/admin/AdminDashboard").then((m) => ({ default: m.AdminDashboard })),
);
const ClientDashboard = lazy(() =>
  import("@/components/client/ClientDashboard").then((m) => ({ default: m.ClientDashboard })),
);
const SellerDashboard = lazy(() =>
  import("@/components/seller/SellerDashboard").then((m) => ({ default: m.SellerDashboard })),
);
const AgencyDashboard = lazy(() =>
  import("@/components/agency/AgencyDashboard").then((m) => ({ default: m.AgencyDashboard })),
);

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <ProtectedGuard>
      <DashboardLayout>
        <Suspense fallback={<PageSkeleton />}>
          <DashboardContent />
        </Suspense>
      </DashboardLayout>
    </ProtectedGuard>
  );
}

function DashboardContent() {
  const { isAdmin, isSeller, isAgency, loading, user, role } = useAuth();
  const [showConnectionState, setShowConnectionState] = useState(false);

  useEffect(() => {
    if (role || !user) {
      setShowConnectionState(false);
      return;
    }
    const timer = window.setTimeout(() => setShowConnectionState(true), 5_000);
    return () => window.clearTimeout(timer);
  }, [role, user]);

  // Wait for auth + role to hydrate before picking a dashboard, otherwise
  // on reload the ClientDashboard flashes for admins (race: role=null while loading).
  if (!user) return <PageSkeleton />;
  if (!role && (loading || !showConnectionState)) return <PageSkeleton />;
  if (!role) return <RoleUnavailable />;
  return isAdmin ? (
    <AdminDashboard />
  ) : isAgency ? (
    <AgencyDashboard />
  ) : isSeller ? (
    <SellerDashboard />
  ) : (
    <ClientDashboard />
  );
}

function RoleUnavailable() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <WifiOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-foreground">Database connection is slow</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your login is successful, but account data is temporarily unavailable. We&apos;re retrying
          automatically.
        </p>
        <Button className="mt-5" onClick={() => window.location.reload()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry now
        </Button>
      </div>
    </div>
  );
}
