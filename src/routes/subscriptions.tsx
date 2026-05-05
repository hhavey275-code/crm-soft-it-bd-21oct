import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const SubscriptionsPage = lazy(() => import("@/components/pages/SubscriptionsPage"));

export const Route = createFileRoute("/subscriptions")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><SubscriptionsPage /></Suspense>
  ),
});
