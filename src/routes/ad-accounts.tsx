import { createFileRoute } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import AdAccountsPage from "@/components/pages/AdAccountsPage";

export const Route = createFileRoute("/ad-accounts")({
  component: () => (
    <ProtectedGuard>
      <AdAccountsPage />
    </ProtectedGuard>
  ),
});
