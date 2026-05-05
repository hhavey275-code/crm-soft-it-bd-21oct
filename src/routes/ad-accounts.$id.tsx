import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const AdAccountDetailPage = lazy(() => import("@/components/pages/AdAccountDetailPage"));

export const Route = createFileRoute("/ad-accounts/$id")({
  component: () => (
    <ProtectedGuard><Suspense fallback={<PageSkeleton />}><AdAccountDetailPage /></Suspense></ProtectedGuard>
  ),
});
