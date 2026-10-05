import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const ProfileStockPage = lazy(() => import("@/components/pages/ProfileStockPage"));

export const Route = createFileRoute("/profile-stock")({
  head: () => ({ meta: [{ title: "Profile Stock — Admin" }] }),
  component: () => (
    <ProtectedGuard>
      <Suspense fallback={<PageSkeleton />}>
        <ProfileStockPage />
      </Suspense>
    </ProtectedGuard>
  ),
});
