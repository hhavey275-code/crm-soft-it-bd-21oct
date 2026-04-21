import { DashboardLayout } from "@/components/DashboardLayout";
import { TenantSubscriptions } from "@/components/tenant/TenantSubscriptions";

export default function SubscriptionsPage() {
  return (
    <DashboardLayout>
      <TenantSubscriptions />
    </DashboardLayout>
  );
}
