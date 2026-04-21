import { createFileRoute } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import MyUnusedAccountsPage from "@/components/pages/MyUnusedAccountsPage";

export const Route = createFileRoute("/my-unused-accounts")({
  component: () => (
    <ProtectedGuard>
      <MyUnusedAccountsPage />
    </ProtectedGuard>
  ),
});
