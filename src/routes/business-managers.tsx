import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const BusinessManagersPage = lazy(() => import("@/components/pages/BusinessManagersPage"));

export const Route = createFileRoute("/business-managers")({
  component: () => (
    <ProtectedGuard><Suspense fallback={<PageSkeleton />}><BusinessManagersPage /></Suspense></ProtectedGuard>
  ),
});
