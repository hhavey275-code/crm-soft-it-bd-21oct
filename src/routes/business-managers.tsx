import { createFileRoute } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import BusinessManagersPage from "@/components/pages/BusinessManagersPage";

export const Route = createFileRoute("/business-managers")({
  component: () => (
    <ProtectedGuard>
      <BusinessManagersPage />
    </ProtectedGuard>
  ),
});
