import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AdminClients } from "@/components/admin/AdminClients";
import { AgencyClients } from "@/components/agency/AgencyClients";

export default function ClientsPage() {
  const { isAgency } = useAuth();
  return (
    <DashboardLayout>
      {isAgency ? <AgencyClients /> : <AdminClients />}
    </DashboardLayout>
  );
}
