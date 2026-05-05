import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const AgencyDetailPage = lazy(() => import("@/components/pages/AgencyDetailPage"));

export const Route = createFileRoute("/agencies/$id")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><AgencyDetailPage /></Suspense>
  ),
});
