import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const ReferralPage = lazy(() => import("@/components/pages/ReferralPage"));

export const Route = createFileRoute("/referral")({
  component: () => (
    <ProtectedGuard>
      <Suspense fallback={<PageSkeleton />}>
        <ReferralPage />
      </Suspense>
    </ProtectedGuard>
  ),
});
