import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const BillingsPage = lazy(() => import("@/components/pages/BillingsPage"));

export const Route = createFileRoute("/billings")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><BillingsPage /></Suspense>
  ),
});
