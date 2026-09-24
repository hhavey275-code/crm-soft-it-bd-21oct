import { AdminExternalTopUpRequests } from "@/components/admin/AdminExternalTopUpRequests";
import { ExternalCrmSwitches } from "@/components/admin/ExternalCrmSwitches";
import { DashboardLayout } from "@/components/DashboardLayout";

export default function ExternalTopUpPage() {
  return (
    <DashboardLayout>
      <div className="space-y-4">
        <h1 className="text-xl font-bold md:text-2xl">External Top-Up</h1>
        <ExternalCrmSwitches />
        <AdminExternalTopUpRequests />
      </div>
    </DashboardLayout>
  );
}
