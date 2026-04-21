import { createFileRoute } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { ClientDashboard } from "@/components/client/ClientDashboard";
import { SellerDashboard } from "@/components/seller/SellerDashboard";
import { AgencyDashboard } from "@/components/agency/AgencyDashboard";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <ProtectedGuard>
      <DashboardLayout>
        <DashboardContent />
      </DashboardLayout>
    </ProtectedGuard>
  );
}

function DashboardContent() {
  const { isAdmin, isSeller, isAgency } = useAuth();
  return isAdmin ? <AdminDashboard /> : isAgency ? <AgencyDashboard /> : isSeller ? <SellerDashboard /> : <ClientDashboard />;
}
