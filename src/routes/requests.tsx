import { createFileRoute } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import RequestsPage from "@/components/pages/RequestsPage";

export const Route = createFileRoute("/requests")({
  component: () => (
    <ProtectedGuard>
      <RequestsPage />
    </ProtectedGuard>
  ),
});
