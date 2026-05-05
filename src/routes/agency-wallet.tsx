import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const AgencyWalletPage = lazy(() => import("@/components/pages/AgencyWalletPage"));

export const Route = createFileRoute("/agency-wallet")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><AgencyWalletPage /></Suspense>
  ),
});
