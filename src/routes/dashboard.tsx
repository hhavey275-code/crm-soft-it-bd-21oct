import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useAuth } from "@/contexts/AuthContext";

const AdminDashboard = lazy(() => import("@/components/admin/AdminDashboard").then(m => ({ default: m.AdminDashboard })));
const ClientDashboard = lazy(() => import("@/components/client/ClientDashboard").then(m => ({ default: m.ClientDashboard })));
const SellerDashboard = lazy(() => import("@/components/seller/SellerDashboard").then(m => ({ default: m.SellerDashboard })));
const AgencyDashboard = lazy(() => import("@/components/agency/AgencyDashboard").then(m => ({ default: m.AgencyDashboard })));

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
  const { isAdmin, isSeller, isAgency, loading, user } = useAuth();
  // Wait for auth + role to hydrate before picking a dashboard, otherwise
  // on reload the ClientDashboard flashes for admins (race: role=null while loading).
  if (loading || !user) return <PageSkeleton />;
  return isAdmin ? <AdminDashboard /> : isAgency ? <AgencyDashboard /> : isSeller ? <SellerDashboard /> : <ClientDashboard />;
}
