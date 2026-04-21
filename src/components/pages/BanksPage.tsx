import { DashboardLayout } from "@/components/DashboardLayout";
import { AdminBanks } from "@/components/admin/AdminBanks";
import { AgencyBanks } from "@/components/agency/AgencyBanks";
import { useAuth } from "@/contexts/AuthContext";

export default function BanksPage() {
  const { isAgency } = useAuth();
  return (
    <DashboardLayout>
      {isAgency ? <AgencyBanks /> : <AdminBanks />}
    </DashboardLayout>
  );
}
