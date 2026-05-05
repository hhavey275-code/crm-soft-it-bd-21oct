import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const SystemLogsPage = lazy(() => import("@/components/pages/SystemLogsPage"));

export const Route = createFileRoute("/system-logs")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><SystemLogsPage /></Suspense>
  ),
});
