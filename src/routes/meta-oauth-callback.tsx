import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const MetaOAuthCallback = lazy(() => import("@/components/pages/MetaOAuthCallback"));

export const Route = createFileRoute("/meta-oauth-callback")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><MetaOAuthCallback /></Suspense>
  ),
});
