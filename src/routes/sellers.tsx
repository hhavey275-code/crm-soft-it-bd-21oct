import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const SellersPage = lazy(() => import("@/components/pages/SellersPage"));

export const Route = createFileRoute("/sellers")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><SellersPage /></Suspense>
  ),
});
