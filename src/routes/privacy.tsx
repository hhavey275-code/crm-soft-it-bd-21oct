import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const PrivacyPage = lazy(() => import("@/components/pages/PrivacyPage"));

export const Route = createFileRoute("/privacy")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><PrivacyPage /></Suspense>
  ),
});
