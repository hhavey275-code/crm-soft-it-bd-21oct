import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AdminTopUp } from "@/components/admin/AdminTopUp";
import { ClientTopUp } from "@/components/client/ClientTopUp";
import { AgencyTopUp } from "@/components/agency/AgencyTopUp";

export default function TopUpPage() {
  const { isAdmin, isAgency } = useAuth();
  return (
    <DashboardLayout>
      {isAdmin ? <AdminTopUp /> : isAgency ? <AgencyTopUp /> : <ClientTopUp />}
    </DashboardLayout>
  );
}
