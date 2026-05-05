import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const RequestsPage = lazy(() => import("@/components/pages/RequestsPage"));

export const Route = createFileRoute("/requests")({
  component: () => (
    <ProtectedGuard><Suspense fallback={<PageSkeleton />}><RequestsPage /></Suspense></ProtectedGuard>
  ),
});
