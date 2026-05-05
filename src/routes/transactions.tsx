import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const TransactionsPage = lazy(() => import("@/components/pages/TransactionsPage"));

export const Route = createFileRoute("/transactions")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><TransactionsPage /></Suspense>
  ),
});
