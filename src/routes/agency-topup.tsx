import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AgencyTopUp } from "@/components/agency/AgencyTopUp";

function AgencyTopUpPage() {
  return (
    <DashboardLayout>
      <AgencyTopUp />
    </DashboardLayout>
  );
}

export const Route = createFileRoute("/agency-topup")({ component: AgencyTopUpPage });
