import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const CardVaultPage = lazy(() => import("@/components/pages/CardVaultPage"));

export const Route = createFileRoute("/card-vault")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><CardVaultPage /></Suspense>
  ),
});
