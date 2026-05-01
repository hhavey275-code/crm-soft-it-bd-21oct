import { DashboardLayout } from "@/components/DashboardLayout";
import { AdminAudit } from "@/components/admin/AdminAudit";

export default function AuditPage() {
  return (
    <DashboardLayout>
      <AdminAudit />
    </DashboardLayout>
  );
}