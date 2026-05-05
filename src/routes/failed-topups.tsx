import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const FailedTopUpsPage = lazy(() => import("@/components/pages/FailedTopUpsPage"));

export const Route = createFileRoute("/failed-topups")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><FailedTopUpsPage /></Suspense>
  ),
});
