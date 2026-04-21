import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { AdminRequests } from "@/components/admin/AdminRequests";
import { ClientRequests } from "@/components/client/ClientRequests";

export default function RequestsPage() {
  const { isAdmin } = useAuth();
  return (
    <DashboardLayout>
      {isAdmin ? <AdminRequests /> : <ClientRequests />}
    </DashboardLayout>
  );
}
