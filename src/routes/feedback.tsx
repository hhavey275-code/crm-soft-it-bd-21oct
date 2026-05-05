import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const FeedbackPage = lazy(() => import("@/components/pages/FeedbackPage"));

export const Route = createFileRoute("/feedback")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><FeedbackPage /></Suspense>
  ),
});
