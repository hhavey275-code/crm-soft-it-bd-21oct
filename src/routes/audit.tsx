import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const AuditPage = lazy(() => import("@/components/pages/AuditPage"));

export const Route = createFileRoute("/audit")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><AuditPage /></Suspense>
  ),
});
