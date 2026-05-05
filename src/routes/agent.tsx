import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const AgentPage = lazy(() => import("@/components/pages/AgentPage"));

export const Route = createFileRoute("/agent")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><AgentPage /></Suspense>
  ),
});
