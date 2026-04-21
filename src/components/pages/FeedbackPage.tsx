import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { ClientFeedback } from "@/components/client/ClientFeedback";
import { AdminFeedback } from "@/components/admin/AdminFeedback";

export default function FeedbackPage() {
  const { isAdmin } = useAuth();
  return (
    <DashboardLayout>
      {isAdmin ? <AdminFeedback /> : <ClientFeedback />}
    </DashboardLayout>
  );
}
