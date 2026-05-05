import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const ClientsPage = lazy(() => import("@/components/pages/ClientsPage"));

export const Route = createFileRoute("/clients/")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><ClientsPage /></Suspense>
  ),
});
