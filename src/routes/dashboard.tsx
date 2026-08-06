import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useAuth } from "@/contexts/AuthContext";

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
  // Wait for auth + role to hydrate before picking a dashboard, otherwise
  // on reload the ClientDashboard flashes for admins (race: role=null while loading).
  if (loading || !user) return <PageSkeleton />;
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
    <div className="space-y-4">
      <PageSkeleton />
      <div className="rounded-lg border bg-card p-4 text-center text-sm text-muted-foreground">
        <p>Connection problem — your account details couldn&apos;t load. Retrying…</p>
        <button
          type="button"
          className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    </div>
  );
}
