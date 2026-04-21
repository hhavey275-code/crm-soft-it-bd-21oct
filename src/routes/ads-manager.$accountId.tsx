import { createFileRoute } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import AdsManagerPage from "@/components/pages/AdsManagerPage";

export const Route = createFileRoute("/ads-manager/$accountId")({
  component: () => (
    <ProtectedGuard>
      <AdsManagerPage />
    </ProtectedGuard>
  ),
});
