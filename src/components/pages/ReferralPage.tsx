import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { ClientReferral } from "@/components/client/ClientReferral";
import { AdminReferrals } from "@/components/admin/AdminReferrals";

export default function ReferralPage() {
  const { isAdmin } = useAuth();
  return <DashboardLayout>{isAdmin ? <AdminReferrals /> : <ClientReferral />}</DashboardLayout>;
}
