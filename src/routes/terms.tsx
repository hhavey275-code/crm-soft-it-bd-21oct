import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const TermsPage = lazy(() => import("@/components/pages/TermsPage"));

export const Route = createFileRoute("/terms")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><TermsPage /></Suspense>
  ),
});
