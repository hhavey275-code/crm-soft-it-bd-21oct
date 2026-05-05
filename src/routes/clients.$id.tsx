import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const ClientDetailPage = lazy(() => import("@/components/pages/ClientDetailPage"));

export const Route = createFileRoute("/clients/$id")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><ClientDetailPage /></Suspense>
  ),
});
