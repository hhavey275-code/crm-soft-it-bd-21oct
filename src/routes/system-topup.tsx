import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const SystemTopUpPage = lazy(() => import("@/components/pages/SystemTopUpPage"));

export const Route = createFileRoute("/system-topup")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><SystemTopUpPage /></Suspense>
  ),
});
