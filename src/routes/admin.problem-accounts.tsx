import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const ProblemAccountsPage = lazy(() => import("@/components/pages/ProblemAccountsPage"));

export const Route = createFileRoute("/admin/problem-accounts")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><ProblemAccountsPage /></Suspense>
  ),
});
