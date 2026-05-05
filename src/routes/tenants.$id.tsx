import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const TenantDetailPage = lazy(() => import("@/components/pages/TenantDetailPage"));

export const Route = createFileRoute("/tenants/$id")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><TenantDetailPage /></Suspense>
  ),
});
