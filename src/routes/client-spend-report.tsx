import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const ClientSpendReportPage = lazy(() => import("@/components/pages/ClientSpendReportPage"));

export const Route = createFileRoute("/client-spend-report")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><ClientSpendReportPage /></Suspense>
  ),
});
