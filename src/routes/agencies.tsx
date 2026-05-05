import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const AgenciesPage = lazy(() => import("@/components/pages/AgenciesPage"));

export const Route = createFileRoute("/agencies")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><AgenciesPage /></Suspense>
  ),
});
