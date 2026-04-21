import { createFileRoute } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import AdAccountDetailPage from "@/components/pages/AdAccountDetailPage";

export const Route = createFileRoute("/ad-accounts/$id")({
  component: () => (
    <ProtectedGuard>
      <AdAccountDetailPage />
    </ProtectedGuard>
  ),
});
