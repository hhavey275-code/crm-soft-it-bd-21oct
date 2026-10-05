import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const BuyProfilePage = lazy(() => import("@/components/pages/BuyProfilePage"));

export const Route = createFileRoute("/buy-profile")({
  head: () => ({ meta: [{ title: "Buy Profile" }] }),
  component: () => (
    <ProtectedGuard>
      <Suspense fallback={<PageSkeleton />}>
        <BuyProfilePage />
      </Suspense>
    </ProtectedGuard>
  ),
});
