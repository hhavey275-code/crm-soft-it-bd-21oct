import { DashboardLayout } from "@/components/DashboardLayout";
import { TenantSystemTopUp } from "@/components/tenant/TenantSystemTopUp";

export default function SystemTopUpPage() {
  return (
    <DashboardLayout>
      <TenantSystemTopUp />
    </DashboardLayout>
  );
}
