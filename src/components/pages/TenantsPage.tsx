import { DashboardLayout } from "@/components/DashboardLayout";
import { AdminTenants } from "@/components/admin/AdminTenants";

export default function TenantsPage() {
  return (
    <DashboardLayout>
      <AdminTenants />
    </DashboardLayout>
  );
}
