import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const AdsManagerPage = lazy(() => import("@/components/pages/AdsManagerPage"));

export const Route = createFileRoute("/ads-manager/$accountId")({
  component: () => (
    <ProtectedGuard><Suspense fallback={<PageSkeleton />}><AdsManagerPage /></Suspense></ProtectedGuard>
  ),
});
