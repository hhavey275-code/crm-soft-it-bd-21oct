import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AgencyPayment } from "@/components/agency/AgencyPayment";

function AgencyPaymentsPage() {
  return (
    <DashboardLayout>
      <AgencyPayment />
    </DashboardLayout>
  );
}

export const Route = createFileRoute("/agency-payments")({ component: AgencyPaymentsPage });
