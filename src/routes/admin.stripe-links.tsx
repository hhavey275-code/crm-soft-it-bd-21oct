import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const StripeLinksPage = lazy(() => import("@/components/pages/StripeLinksPage"));

export const Route = createFileRoute("/admin/stripe-links")({
  component: () => (
    <ProtectedGuard><Suspense fallback={<PageSkeleton />}><StripeLinksPage /></Suspense></ProtectedGuard>
  ),
});
