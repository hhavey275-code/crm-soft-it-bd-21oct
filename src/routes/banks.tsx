import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const BanksPage = lazy(() => import("@/components/pages/BanksPage"));

export const Route = createFileRoute("/banks")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><BanksPage /></Suspense>
  ),
});
