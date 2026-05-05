import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const AdminPerformancePage = lazy(() => import("@/components/pages/AdminPerformancePage"));

export const Route = createFileRoute("/admin/performance")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><AdminPerformancePage /></Suspense>
  ),
});
