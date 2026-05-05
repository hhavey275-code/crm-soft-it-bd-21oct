import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const InvoicePage = lazy(() => import("@/components/pages/InvoicePage"));

export const Route = createFileRoute("/invoice/$requestId")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><InvoicePage /></Suspense>
  ),
});
