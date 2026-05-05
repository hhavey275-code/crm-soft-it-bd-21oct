import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const MyUnusedAccountsPage = lazy(() => import("@/components/pages/MyUnusedAccountsPage"));

export const Route = createFileRoute("/my-unused")({
  component: () => (
    <ProtectedGuard><Suspense fallback={<PageSkeleton />}><MyUnusedAccountsPage /></Suspense></ProtectedGuard>
  ),
});
