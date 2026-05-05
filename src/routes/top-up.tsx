import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const TopUpPage = lazy(() => import("@/components/pages/TopUpPage"));

export const Route = createFileRoute("/top-up")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><TopUpPage /></Suspense>
  ),
});
