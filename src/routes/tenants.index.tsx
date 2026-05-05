import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const TenantsPage = lazy(() => import("@/components/pages/TenantsPage"));

export const Route = createFileRoute("/tenants/")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><TenantsPage /></Suspense>
  ),
});
