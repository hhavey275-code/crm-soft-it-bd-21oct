import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DashboardLayout } from "@/components/DashboardLayout";

const SellerTopUpApprovals = lazy(() =>
  import("@/components/seller/SellerTopUpApprovals").then((m) => ({ default: m.SellerTopUpApprovals }))
);

export const Route = createFileRoute("/seller-topups")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardLayout>
        <SellerTopUpApprovals />
      </DashboardLayout>
    </Suspense>
  ),
});
