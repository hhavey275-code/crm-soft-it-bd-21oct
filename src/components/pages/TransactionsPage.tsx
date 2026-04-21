import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AdminTransactions } from "@/components/admin/AdminTransactions";
import { ClientTransactions } from "@/components/client/ClientTransactions";
import { AgencyTransactions } from "@/components/agency/AgencyTransactions";

export default function TransactionsPage() {
  const { isAdmin, isAgency } = useAuth();
  return (
    <DashboardLayout>
      {isAdmin ? <AdminTransactions /> : isAgency ? <AgencyTransactions /> : <ClientTransactions />}
    </DashboardLayout>
  );
}
