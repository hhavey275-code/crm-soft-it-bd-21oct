import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const OldSellerPage = lazy(() => import("@/components/pages/OldSellerPage"));

export const Route = createFileRoute("/old-seller")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><OldSellerPage /></Suspense>
  ),
});
