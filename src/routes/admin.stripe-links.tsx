import { createFileRoute } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import StripeLinksPage from "@/components/pages/StripeLinksPage";

export const Route = createFileRoute("/admin/stripe-links")({
  component: () => (
    <ProtectedGuard>
      <StripeLinksPage />
    </ProtectedGuard>
  ),
});
